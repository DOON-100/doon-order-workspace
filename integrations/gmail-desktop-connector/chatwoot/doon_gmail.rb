# Loaded as an initializer only in the independent Chatwoot containers.
# Google credentials never reach this process. All Gmail I/O runs on Windows.
require 'base64'
require 'json'
require 'digest'
require 'securerandom'
Rails.application.config.filter_parameters += %i[raw email token authorization x_doon_gmail_key]

Rails.application.config.to_prepare do
module DoonGmail
  class Link < ActiveRecord::Base
    self.table_name = 'doon_gmail_links'
  end
  class ThreadMap < ActiveRecord::Base
    self.table_name = 'doon_gmail_threads'
  end
  class MessageMap < ActiveRecord::Base
    self.table_name = 'doon_gmail_messages'
  end
  class Job < ActiveRecord::Base
    self.table_name = 'doon_gmail_jobs'
  end

  class << self
    def config
      @config ||= JSON.parse(File.read(ENV.fetch('DOON_GMAIL_CONFIG')))
    end

    def link
      Link.find_by(id: 1)
    end

    def bound?(inbox_id)
      link&.inbox_id == inbox_id
    end

    def register(email)
      raise 'Invalid Gmail address' unless email.match?(Devise.email_regexp) && email.bytesize < 255
      Link.transaction do
        ActiveRecord::Base.connection.execute('SELECT pg_advisory_xact_lock(783426109)')
        existing = link
        if existing
          raise 'Mailbox identity mismatch' unless existing.email.casecmp?(email)
          return existing
        end
        account = Account.find(config.fetch('account_id'))
        user = account.users.find(config.fetch('user_id'))
        if config['private_workspace']
          account = Account.create!(name: '个人 Gmail · 本机同步', locale: account.locale)
          AccountUser.create!(account: account, user: user, role: :administrator)
        end
        # A native Email channel address is globally unique. Keep any existing
        # channel intact; this adapter has its own internal routing identifier.
        channel_email = Channel::Email.exists?(email: email) ? "doon-gmail-#{SecureRandom.hex(16)}@connector.invalid" : email
        channel = Channel::Email.create!(account: account, email: channel_email, imap_enabled: false, smtp_enabled: false)
        inbox = account.inboxes.create!(name: '个人 Gmail · 本机同步', channel: channel, enable_auto_assignment: false)
        inbox.inbox_members.create!(user: user)
        Link.create!(id: 1, account_id: account.id, user_id: user.id, inbox_id: inbox.id, email: email.downcase)
      end
    end

    def enqueue_send(message)
      return if message.private? || !message.outgoing? || message.source_id.present? || message.content_attributes['deleted']
      l = link
      message.with_lock do
        existing = Job.find_by(message_id: message.id)
        if existing
          existing.update!(state: 'queued', reason: nil) if existing.state == 'failed' && !message.failed?
          return
        end
        delivery = ConversationReplyMailer.with(account: message.account).email_reply(message).message
        raise 'Email rendering failed' unless delivery.to.present?
        rfc_id = "<doon-gmail-#{l.id}-#{message.id}@#{l.email.split('@').last}>"
        delivery.from = l.email
        delivery.reply_to = l.email
        delivery.message_id = rfc_id
        raw = delivery.encoded
        raise 'Email exceeds Gmail maximum size' if raw.bytesize > 35 * 1024 * 1024
        thread_map = ThreadMap.find_by(link_id: l.id, conversation_id: message.conversation_id)
        Job.create!(id: SecureRandom.uuid, link_id: l.id, kind: 'send', message_id: message.id,
                    conversation_id: message.conversation_id,
                    payload: { raw: Base64.urlsafe_encode64(raw, padding: false), rfc_message_id: rfc_id, thread_id: thread_map&.gmail_id })
      end
    end

    def enqueue_labels(conversation, add, remove)
      return unless bound?(conversation.inbox_id)
      ids = MessageMap.where(link_id: 1, conversation_id: conversation.id, missing: false).pluck(:gmail_id)
      return if ids.empty?
      Job.create!(id: SecureRandom.uuid, link_id: 1, kind: 'labels', conversation_id: conversation.id,
                  payload: { message_ids: ids, add: add, remove: remove })
    end

    def sync_conversation(conversation)
      maps = MessageMap.where(link_id: 1, conversation_id: conversation.id, missing: false).to_a
      return if maps.empty?
      # Do not overwrite an explicit offline user action with an older Gmail snapshot.
      return if Job.where(link_id: 1, conversation_id: conversation.id, kind: 'labels', state: %w[queued leased]).exists?
      unread = maps.select { |m| m.labels.include?('UNREAD') }.map { |m| Message.find(m.message_id).created_at }.min
      last_seen = unread ? unread - 1.second : Time.current
      conversation.update!(status: maps.any? { |m| m.labels.include?('INBOX') } ? 'open' : 'resolved',
                           agent_last_seen_at: last_seen, assignee_last_seen_at: last_seen)
      ::Conversations::UnreadCounts::Notifier.new(conversation).perform
    end

    def ingest(data)
      l = link or raise 'Mailbox not registered'
      id = data.fetch('id'); thread_id = data.fetch('threadId')
      raise 'Invalid Gmail identifiers' unless id.match?(/\A[a-f0-9]{1,64}\z/) && thread_id.match?(/\A[a-f0-9]{1,64}\z/)
      labels = Array(data['labelIds']).map(&:to_s)
      return { ignored: true } if labels.include?('DRAFT')
      MessageMap.transaction do
        l.lock!
        mapped = MessageMap.find_by(link_id: l.id, gmail_id: id)
        if mapped
          mapped.update!(labels: labels, missing: false)
          sync_conversation(Conversation.find(mapped.conversation_id))
          return { id: mapped.message_id }
        end
        return { need_raw: true } unless data['raw'].present?
        original = Base64.urlsafe_decode64(data['raw'])
        raise 'Email exceeds supported maximum size' if original.bytesize > 50 * 1024 * 1024
        mail = Mail.read_from_string(original)
        # An outbound Gmail echo must bind to the original Chatwoot bubble.
        own = Job.where(link_id: l.id, kind: 'send').where("payload->>'rfc_message_id' = ?", "<#{mail.message_id}>").first
        if own
          complete_send(own, data)
          return { id: own.message_id }
        end
        tm = ThreadMap.find_by(link_id: l.id, gmail_id: thread_id)
        if tm
          conversation = Conversation.find(tm.conversation_id)
        else
          addresses = labels.include?('SENT') ? Array(mail.to) : Array(mail.reply_to).presence || Array(mail.from)
          address = addresses.first.to_s.downcase
          identifier = "doon-gmail:#{l.id}:#{Digest::SHA256.hexdigest(address)}"
          contact = Contact.find_by(account_id: l.account_id, identifier: identifier)
          unless contact
            # Reusing a different channel's contact would update its activity.
            # Create our own record; do not change an original contact on collision.
            usable_email = address.match?(Devise.email_regexp) && !Contact.exists?(account_id: l.account_id, email: address)
            contact = Contact.create!(account_id: l.account_id, identifier: identifier,
                                      email: usable_email ? address : nil, name: address.presence || 'Gmail 邮件',
                                      additional_attributes: { doon_gmail_owner: l.id, gmail_address: address })
          end
          ci = ContactInbox.find_or_create_by!(inbox_id: l.inbox_id, contact_id: contact.id) { |v| v.source_id = identifier }
          conversation = Conversation.create!(account_id: l.account_id, inbox_id: l.inbox_id, contact: contact, contact_inbox: ci,
                                                assignee_id: l.user_id, additional_attributes: { mail_subject: mail.subject.to_s.delete("\u0000").first(500) })
          ThreadMap.create!(link_id: l.id, gmail_id: thread_id, conversation_id: conversation.id)
        end
        presenter = MailPresenter.new(mail, Account.find(l.account_id))
        serialized = presenter.serialized_data.deep_transform_values { |v| v.is_a?(String) ? v.delete("\u0000") : v }
        content = (presenter.text_content[:reply].presence || ActionController::Base.helpers.strip_tags(presenter.html_content[:reply].to_s)).to_s.first(150_000)
        created = Time.at(Integer(data.fetch('internalDate')) / 1000.0).utc
        message = conversation.messages.build(account_id: l.account_id, inbox_id: l.inbox_id,
                   sender: labels.include?('SENT') ? User.find(l.user_id) : conversation.contact,
                   message_type: labels.include?('SENT') ? 'outgoing' : 'incoming', content_type: 'incoming_email',
                   content: content, source_id: mail.message_id.presence || "gmail:#{id}", created_at: created,
                   content_attributes: { email: serialized, doon_gmail_id: id })
        message.attachments.build(account_id: l.account_id, file_type: 'file',
                                   file: { io: StringIO.new(original), filename: "original-#{id}.eml", content_type: 'message/rfc822' })
        # Chatwoot permits 15 attachments. The full EML always preserves all parts.
        mail.attachments.first(14).each do |part|
          message.attachments.build(account_id: l.account_id, file_type: attachment_type(part.mime_type),
                                     file: { io: StringIO.new(part.decoded), filename: part.filename.presence || 'attachment', content_type: part.mime_type })
        end
        message.content_attributes['doon_gmail_attachment_note'] = '附件超过界面上限，全部附件保留在 original.eml 中。' if mail.attachments.size > 14
        message.save!
        # Inline CID images use the same authenticated original-file route.
        mail.attachments.first(14).zip(message.attachments.to_a.drop(1)).each do |part, attachment|
          next if part.content_id.blank?
          cid = part.content_id.delete_prefix('<').delete_suffix('>')
          url = Rails.application.routes.url_helpers.rails_blob_path(attachment.file.blob, only_path: true)
          %w[full reply quoted].each do |key|
            html = message.content_attributes.dig('email', 'html_content', key)
            message.content_attributes['email']['html_content'][key] = html.gsub('cid:' + cid, url) if html.is_a?(String)
          end
        end
        message.save! if mail.attachments.any? { |part| part.content_id.present? }
        MessageMap.create!(link_id: l.id, gmail_id: id, gmail_thread_id: thread_id, message_id: message.id,
                           conversation_id: conversation.id, labels: labels)
        sync_conversation(conversation.reload)
        { id: message.id }
      end
    end

    def attachment_type(mime)
      %w[image audio video].find { |type| mime.to_s.start_with?(type + '/') } || 'file'
    end

    def complete_send(job, result)
      message = Message.find(job.message_id)
      gmail_id = result.fetch('id'); thread_id = result.fetch('threadId')
      existing = MessageMap.find_by(link_id: 1, gmail_id: gmail_id)
      raise 'Gmail result is already bound to another message' if existing && existing.message_id != message.id
      MessageMap.find_or_create_by!(link_id: 1, gmail_id: gmail_id) do |m|
        m.gmail_thread_id = thread_id; m.message_id = message.id; m.conversation_id = message.conversation_id; m.labels = result['labelIds'] || ['SENT']
      end
      ThreadMap.find_or_create_by!(link_id: 1, conversation_id: message.conversation_id) { |m| m.gmail_id = thread_id }
      message.update!(source_id: job.payload['rfc_message_id'].delete_prefix('<').delete_suffix('>'), status: 'sent',
                      content_attributes: message.content_attributes.except('external_error').merge('doon_gmail_transport' => 'sent'))
      job.update!(state: 'done', result: result.slice('id', 'threadId'), reason: nil, lease: nil, lease_until: nil)
    end
  end

  module SendAdapter
    def perform
      return super unless DoonGmail.bound?(message.inbox_id)
      DoonGmail.enqueue_send(message)
    rescue StandardError
      # Logs deliberately exclude MIME, recipients, tokens and exception payloads.
      raise unless DoonGmail.bound?(message.inbox_id)
      message.update!(status: 'failed', content_attributes: message.content_attributes.merge('external_error' => '本机 Gmail 作业创建失败，请检查连接器状态。'))
    end
  end
  module MailerAdapter
    def smtp_config_set_or_development?
      return true if @inbox && DoonGmail.bound?(@inbox.id)
      super
    end
    def to_emails
      result = super
      return result if result.compact_blank.present? || !DoonGmail.bound?(@inbox.id)
      @conversation.messages.incoming.last&.content_attributes&.dig('email', 'from') || []
    end
  end
  module MessageStatus
    def status
      # `progress` is an existing native Chatwoot UI status. No schema/enum change.
      return 'progress' if outgoing? && !private? && source_id.blank? && self[:status] != 'failed' && DoonGmail.bound?(inbox_id)
      super
    end
    private
    def reopen_conversation
      return if content_attributes['doon_gmail_id'].present?
      super
    end
    def set_conversation_activity
      return super unless DoonGmail.bound?(inbox_id)
      latest = conversation.messages.chat.maximum(:created_at) || created_at
      conversation.update_columns(last_activity_at: latest, updated_at: Time.current)
    end
  end
  module ConversationActions
    def update_last_seen
      gmail_action([], ['UNREAD']) { super }
    end
    def unread
      gmail_action(['UNREAD'], []) { super }
    end
    def toggle_status
      return super unless DoonGmail.bound?(@conversation.inbox_id)
      raise Pundit::NotAuthorizedError unless Current.user.id == DoonGmail.link.user_id
      Conversation.transaction do
        super
        DoonGmail.enqueue_labels(@conversation, @conversation.open? ? ['INBOX'] : [], @conversation.resolved? ? ['INBOX'] : []) if @conversation.open? || @conversation.resolved?
      end
    end
    private
    def gmail_action(add, remove)
      return yield unless DoonGmail.bound?(@conversation.inbox_id)
      # Viewing by a different administrator never mutates the owner's Gmail.
      return yield unless Current.user.id == DoonGmail.link.user_id
      Conversation.transaction { @conversation.lock!; yield; DoonGmail.enqueue_labels(@conversation, add, remove) }
    end
  end
  module DashboardScripts
    private
    def set_dashboard_scripts
      super
      @dashboard_scripts = @dashboard_scripts.to_s + '<script defer src="/chatwoot/gmail-ui.js"></script>'
    end
  end

  class BridgeController < ActionController::API
    before_action :authorize_connector
    rescue_from StandardError, with: :safe_error
    def register
      l = DoonGmail.register(params.require(:email).to_s.downcase)
      render json: { inbox_id: l.inbox_id, account_id: l.account_id }
    end
    def heartbeat
      updates = { heartbeat_at: Time.current }; updates[:synced_at] = Time.current if params[:synced]
      DoonGmail.link.update!(updates); render json: { ok: true }
    end
    def ingest
      render json: DoonGmail.ingest(params.to_unsafe_h)
    end
    def missing
      mapped = MessageMap.find_by(link_id: 1, gmail_id: params.require(:id))
      mapped&.update!(missing: true)
      render json: { ok: true }
    end
    def claim
      result = []
      Job.transaction do
        ActiveRecord::Base.connection.execute('SELECT pg_advisory_xact_lock(783426110)')
        # Only one live request owns the queue, preserving label-action order.
        active = Job.where(link_id: 1, state: 'leased').where('lease_until > ?', Time.current).exists?
        unless active
          job = Job.where(link_id: 1).where("state = 'queued' OR (state = 'leased' AND lease_until <= ?) OR (state = 'uncertain' AND updated_at < ?)", Time.current, 30.seconds.ago).order(:created_at).lock('FOR UPDATE SKIP LOCKED').first
          if job
            job.update!(state: 'leased', lease: SecureRandom.uuid, lease_until: 5.minutes.from_now)
            result << job.payload.merge(id: job.id, kind: job.kind, lease: job.lease)
          end
        end
      end
      render json: { jobs: result }
    end
    def complete
      with_job do |job|
        if job.kind == 'send'
          DoonGmail.complete_send(job, params.require(:result).to_unsafe_h)
        else
          job.update!(state: 'done', reason: nil, lease: nil, lease_until: nil)
        end
      end
      render json: { ok: true }
    end
    def defer
      with_job do |job|
        permanent = params[:permanent] == true
        job.update!(state: permanent ? 'failed' : 'queued', reason: params[:reason].to_s.first(60), lease: nil, lease_until: nil)
        if permanent && job.message_id
          message = Message.find(job.message_id)
          message.update!(status: 'failed', content_attributes: message.content_attributes.merge('external_error' => 'Gmail 拒绝发送，请检查授权、收件人和连接器状态。'))
        end
      end
      render json: { ok: true }
    end
    def uncertain
      with_job { |job| job.update!(state: 'uncertain', reason: 'sent-result-unknown', lease: nil, lease_until: nil) }
      render json: { ok: true }
    end
    private
    def authorize_connector
      supplied = request.headers['X-Doon-Gmail-Key'].to_s
      expected = DoonGmail.config.fetch('token_sha256')
      valid = supplied.bytesize.between?(43,128) && ActiveSupport::SecurityUtils.secure_compare(Digest::SHA256.hexdigest(supplied), expected)
      l = DoonGmail.link
      valid &&= !l || AccountUser.exists?(account_id: l.account_id, user_id: l.user_id)
      head :unauthorized unless valid
    end
    def with_job
      Job.transaction do
        job = Job.where(link_id: 1).lock.find(params.require(:id))
        raise 'Job lease mismatch' unless job.state == 'leased' && job.lease == params.require(:lease)
        yield job
      end
    end
    def safe_error
      render json: { error: 'Connector request failed; original records were preserved.' }, status: :unprocessable_entity
    end
  end

  class StatusController < Api::V1::Accounts::BaseController
    def show
      l = DoonGmail.link
      return render json: { enabled: false } unless l && l.account_id == Current.account.id
      return head :forbidden unless Current.user.id == l.user_id || Current.account_user.administrator?
      conversation = params[:conversation].present? ? Current.account.conversations.find_by(display_id: params[:conversation], inbox_id: l.inbox_id) : nil
      jobs = conversation ? Job.where(link_id: 1, conversation_id: conversation.id).where.not(state: 'done') : Job.none
      maps = conversation ? MessageMap.where(link_id: 1, conversation_id: conversation.id, missing: false).to_a : []
      render json: { enabled: true, email: l.email, online: l.heartbeat_at && l.heartbeat_at > 60.seconds.ago, synced_at: l.synced_at,
                     inbox_id: l.inbox_id, conversation: conversation&.display_id, owner: Current.user.id == l.user_id,
                     pending: jobs.count, uncertain: jobs.where(state: 'uncertain').count,
                     attachment_notes: conversation && conversation.messages.where("content_attributes ? 'doon_gmail_attachment_note'").exists?,
                     unread: maps.any? { |m| m.labels.include?('UNREAD') }, archived: maps.present? && maps.none? { |m| m.labels.include?('INBOX') } }
    end
  end

  class BlobScopeController < ActionController::API
    def check
      token = request.headers['X-Doon-Gmail-Gateway'].to_s
      return head :unauthorized unless token.bytesize == 43 && ActiveSupport::SecurityUtils.secure_compare(Digest::SHA256.hexdigest(token), DoonGmail.config.fetch('blob_token_sha256'))
      l = DoonGmail.link
      return render json: { allowed: true } unless l
      pathname = params.require(:path).to_s
      blob = nil
      if (match = pathname.match(%r{\A/rails/active_storage/(?:blobs|representations)/(?:redirect/|proxy/)?([^/]+)/}))
        blob = ActiveStorage::Blob.find_signed(Rack::Utils.unescape_path(match[1]))
      elsif (match = pathname.match(%r{\A/rails/active_storage/disk/([^/]+)/}))
        decoded = ActiveStorage.verifier.verified(Rack::Utils.unescape_path(match[1]), purpose: :blob_key)
        blob = ActiveStorage::Blob.find_by(key: decoded[:key] || decoded['key']) if decoded
      end
      protected_blob = blob && ::Attachment.where(id: blob.attachments.where(record_type: 'Attachment').select(:record_id)).joins(:message).where(messages: { inbox_id: l.inbox_id }).exists?
      member = AccountUser.find_by(account_id: l.account_id, user_id: params[:user_id])
      allowed = !protected_blob || (member && (member.user_id == l.user_id || member.administrator?))
      render json: { allowed: !!allowed }
    rescue StandardError
      render json: { allowed: false }, status: :forbidden
    end
  end
end

  Email::SendOnEmailService.prepend(DoonGmail::SendAdapter) unless Email::SendOnEmailService < DoonGmail::SendAdapter
  ConversationReplyMailer.prepend(DoonGmail::MailerAdapter) unless ConversationReplyMailer < DoonGmail::MailerAdapter
  Message.prepend(DoonGmail::MessageStatus) unless Message < DoonGmail::MessageStatus
  Api::V1::Accounts::ConversationsController.prepend(DoonGmail::ConversationActions) unless Api::V1::Accounts::ConversationsController < DoonGmail::ConversationActions
  DashboardController.prepend(DoonGmail::DashboardScripts) unless DashboardController < DoonGmail::DashboardScripts
end
Rails.application.routes.append do
  %w[register heartbeat ingest missing claim complete defer uncertain].each do |action|
    post "/chatwoot/gmail-bridge/v1/#{action}", to: "doon_gmail/bridge##{action}"
  end
  get '/api/v1/accounts/:account_id/doon_gmail/status', to: 'doon_gmail/status#show'
  post '/doon-gmail-internal/blob-scope', to: 'doon_gmail/blob_scope#check'
end
