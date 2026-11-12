# Execute only in an ephemeral schema-only database and an isolated Redis/storage.
abort 'Synthetic database required' unless ActiveRecord::Base.connection.select_value('SELECT current_database()').start_with?('doon_gmail_synthetic_')
require 'rack/mock'
require 'digest'
checks = 0
def check(value, message)
  raise "Synthetic assertion failed: #{message}" unless value
end
account = Account.create!(name: 'Synthetic Gmail', locale: 'zh_CN')
owner = User.create!(name: 'Synthetic Owner', email: 'owner@test.invalid', password: SecureRandom.hex(24) + 'aA1!', confirmed_at: Time.current)
AccountUser.create!(account: account, user: owner, role: :administrator)
other_user = User.create!(name: 'Synthetic Other Employee', email: 'other@test.invalid', password: SecureRandom.hex(24) + 'aA1!', confirmed_at: Time.current)
other_member = AccountUser.create!(account: account, user: other_user, role: :agent)
original_contact = Contact.create!(account: account, name: 'Existing unrelated contact', email: 'sender@test.invalid')
original_channel = Channel::Email.create!(account: account, email: 'me@test.invalid', imap_enabled: false, smtp_enabled: false)
original_inbox = account.inboxes.create!(name: 'Existing unrelated inbox', channel: original_channel)
original = [original_contact, original_inbox, other_member].map { |r| Digest::SHA256.hexdigest(r.reload.attributes.to_json) }
check(account.id == DoonGmail.config['account_id'] && owner.id == DoonGmail.config['user_id'], 'synthetic owner IDs')
app = Rack::MockRequest.new(Rails.application)
key = 's' * 43
post_bridge = lambda do |action, payload|
  response = app.post("/chatwoot/gmail-bridge/v1/#{action}", 'CONTENT_TYPE' => 'application/json', 'HTTP_X_DOON_GMAIL_KEY' => key, input: payload.to_json)
  check(response.status == 200, "bridge #{action}: #{response.status} #{response.body.first(500)}")
  JSON.parse(response.body)
end
bad = app.post('/chatwoot/gmail-bridge/v1/register', 'CONTENT_TYPE' => 'application/json', input: { email: 'me@test.invalid' }.to_json)
check(bad.status == 401, 'connector auth required'); checks += 1
registered = post_bridge.call('register', { email: 'me@test.invalid' })
l = DoonGmail.link
workspace = Account.find(l.account_id)
check(workspace.id != account.id && workspace.users.pluck(:id) == [owner.id], 'private mailbox workspace isolates contacts and messages'); checks += 1
collision = workspace.contacts.create!(email: 'sender@test.invalid', name: 'Existing private contact')
collision_hash = Digest::SHA256.hexdigest(collision.attributes.to_json)
check(l.inbox_id == registered['inbox_id'] && l.inbox_id != original_inbox.id, 'new inbox only')
check(Inbox.find(l.inbox_id).members.pluck(:id) == [owner.id], 'sole inbox member')
check(!Inbox.find(l.inbox_id).channel.imap_enabled && !Inbox.find(l.inbox_id).channel.smtp_enabled, 'no Google server connection'); checks += 1
check(Inbox.find(l.inbox_id).channel.email.end_with?('@connector.invalid') && original_channel.reload.email == 'me@test.invalid', 'address collision uses a separate internal channel'); checks += 1
check(post_bridge.call('register', { email: 'me@test.invalid' })['inbox_id'] == l.inbox_id, 'idempotent registration'); checks += 1
mail = Mail.new do
  from 'sender@test.invalid'; to 'me@test.invalid'; subject 'Synthetic subject'
  message_id '<synthetic-incoming@test.invalid>'
  text_part { body 'Synthetic text body' }
  html_part { content_type 'text/html; charset=UTF-8'; body '<p>Synthetic text body</p>' }
  add_file filename: 'synthetic.txt', content: 'Synthetic attachment'
end
item = { id: 'a1', threadId: 'b1', internalDate: (1.day.ago.to_f * 1000).to_i.to_s, raw: Base64.urlsafe_encode64(mail.encoded, padding: false), labelIds: %w[INBOX UNREAD] }
post_bridge.call('ingest', item)
mapped = DoonGmail::MessageMap.find_by!(gmail_id: 'a1')
message = Message.find(mapped.message_id); conversation = message.conversation
check(message.incoming? && message.source_id == 'synthetic-incoming@test.invalid', 'incoming native email')
check(message.content_attributes.dig('email', 'subject') == 'Synthetic subject', 'email headers preserved')
check(message.attachments.count == 2 && message.attachments.any? { |a| a.file.filename.to_s.end_with?('.eml') }, 'attachment and RFC original preserved')
blob_path = Rails.application.routes.url_helpers.rails_blob_path(message.attachments.first.file.blob, only_path: true)
blob_headers = { 'CONTENT_TYPE' => 'application/json', 'HTTP_X_DOON_GMAIL_GATEWAY' => 'g' * 43 }
allowed = app.post('/doon-gmail-internal/blob-scope', blob_headers.merge(input: { path: blob_path, user_id: owner.id }.to_json))
denied = app.post('/doon-gmail-internal/blob-scope', blob_headers.merge(input: { path: blob_path, user_id: 987654321 }.to_json))
check(allowed.status == 200 && JSON.parse(allowed.body)['allowed'] && denied.status == 200 && !JSON.parse(denied.body)['allowed'], 'copied Gmail original URL enforces membership'); checks += 1
check(conversation.contact_id != original_contact.id && conversation.contact.email.nil?, 'contact collision preserves old contact'); checks += 1
before = Message.count
post_bridge.call('ingest', item.except(:raw).merge(labelIds: []))
check(Message.count == before && conversation.reload.resolved?, 'deduplication and Gmail archive mirror'); checks += 1
post_bridge.call('ingest', item)
check(conversation.reload.open? && conversation.unread_messages.incoming.exists?, 'Gmail unread and inbox mirror'); checks += 1
token = owner.create_new_auth_token
headers = token.to_h { |k,v| ["HTTP_#{k.upcase.tr('-', '_')}",v] }.merge('CONTENT_TYPE' => 'application/json')
post_native = lambda do |action, payload|
  response = app.post("/api/v1/accounts/#{workspace.id}/conversations/#{conversation.display_id}/#{action}", headers.merge(input: payload.to_json))
  check(response.status == 200, "native #{action}: #{response.status} #{response.body.first(200)}")
end
post_native.call('update_last_seen', {})
job = DoonGmail::Job.order(:created_at).last
check(job.kind == 'labels' && job.payload['message_ids'] == ['a1'] && job.payload['remove'] == ['UNREAD'], 'native reading queues Gmail read action'); checks += 1
claimed = post_bridge.call('claim', {})['jobs'].first
check(claimed['id'] == job.id && post_bridge.call('claim', {})['jobs'].empty?, 'exclusive durable lease')
post_bridge.call('complete', { id: claimed['id'], lease: claimed['lease'], result: { ok: true } }); checks += 1
post_native.call('unread', {})
check(DoonGmail::Job.order(:created_at).last.payload['add'] == ['UNREAD'], 'native unread action'); checks += 1
post_native.call('toggle_status', { status: 'resolved' })
check(DoonGmail::Job.order(:created_at).last.payload['remove'] == ['INBOX'], 'native resolve queues Gmail archive'); checks += 1
outgoing = Messages::MessageBuilder.new(owner, conversation, { content: 'Synthetic outbound body', message_type: 'outgoing', to_emails: 'recipient@test.invalid', subject: 'Synthetic reply' }).perform
check(outgoing.status == 'progress', 'queued email is not displayed as sent')
Email::SendOnEmailService.new(message: outgoing).perform
send_job = DoonGmail::Job.find_by!(message_id: outgoing.id)
encoded = Mail.read_from_string(Base64.urlsafe_decode64(send_job.payload['raw']))
check(encoded.from == ['me@test.invalid'] && encoded.to == ['recipient@test.invalid'], 'native MIME sender and recipients')
check(encoded.in_reply_to == 'synthetic-incoming@test.invalid', 'reply threading preserved')
check(encoded.message_id == send_job.payload['rfc_message_id'].delete_prefix('<').delete_suffix('>'), 'stable RFC Message-ID')
Email::SendOnEmailService.new(message: outgoing).perform
check(DoonGmail::Job.where(message_id: outgoing.id).count == 1, 'duplicate worker execution cannot queue duplicate email'); checks += 1
DoonGmail::Job.where(kind: 'labels').update_all(state: 'done')
claimed_send = post_bridge.call('claim', {})['jobs'].first
check(claimed_send['id'] == send_job.id, 'outbox polling')
post_bridge.call('complete', { id: send_job.id, lease: claimed_send['lease'], result: { id: 'a2', threadId: 'b1', labelIds: ['SENT'] } })
check(outgoing.reload.status == 'sent' && outgoing.source_id.present?, 'only Gmail acknowledgement marks sent'); checks += 1
post_bridge.call('ingest', { id: 'a2', threadId: 'b1', labelIds: ['SENT'] })
check(DoonGmail::MessageMap.where(gmail_id: 'a2').count == 1, 'sent echo deduplicates'); checks += 1
older = Mail.read_from_string(mail.encoded); older.message_id = '<synthetic-older@test.invalid>'
post_bridge.call('ingest', item.merge(id: 'a0', internalDate: (3.days.ago.to_f * 1000).to_i.to_s, raw: Base64.urlsafe_encode64(older.encoded, padding: false), labelIds: []))
check((conversation.reload.last_activity_at.to_f - outgoing.reload.created_at.to_f).abs < 0.001, 'older backfill preserves latest message chronology'); checks += 1
post_bridge.call('missing', { id: 'a1' })
check(Message.exists?(message.id) && message.attachments.reload.count == 2, 'Gmail removal preserves Chatwoot original'); checks += 1
other_headers = other_user.create_new_auth_token.to_h { |k,v| ["HTTP_#{k.upcase.tr('-', '_')}",v] }
private_contacts = app.get("/api/v1/accounts/#{workspace.id}/contacts", other_headers)
check([401,403,404].include?(private_contacts.status), 'ordinary employee cannot enumerate Gmail contacts'); checks += 1
check(Digest::SHA256.hexdigest(collision.reload.attributes.to_json) == collision_hash, 'existing same-address contact is preserved'); checks += 1
check([original_contact, original_inbox, other_member].map { |r| Digest::SHA256.hexdigest(r.reload.attributes.to_json) } == original, 'original records unchanged'); checks += 1
puts({ ok: true, synthetic_only: true, checks: checks, google_requests: 0, original_records_preserved: true }.to_json)
