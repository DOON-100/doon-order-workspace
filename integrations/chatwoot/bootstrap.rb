# Run once inside the new Chatwoot container. Never read or mount the business DB.
abort 'DOON_BOOTSTRAP_OUTPUT is required' if ENV['DOON_BOOTSTRAP_OUTPUT'].blank?
output = ENV.fetch('DOON_BOOTSTRAP_OUTPUT')
abort 'Output already exists; inspect the existing deployment' if File.exist?(output)
abort 'Only an empty Chatwoot installation may be bootstrapped' if Account.exists? || User.exists? || PlatformApp.exists?
result = ActiveRecord::Base.transaction do
  app = PlatformApp.create!(name: 'DOON middle platform identity bridge')
  account = Account.create!(name: 'DOON Chatwoot trial', locale: 'zh_CN')
  PlatformAppPermissible.create!(platform_app: app, permissible: account)
  { accountId: account.id, platformToken: app.access_token.token }
end
File.open(output, File::WRONLY | File::CREAT | File::EXCL, 0o600) { |file| file.write(JSON.generate(result)) }
# Programmatic setup replaces the native first-run signup wizard. Do not enroll
# employees in Chatwoot's installer or subscribe the installation to updates.
::Redis::Alfred.delete(::Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)
puts JSON.generate({ ok: true, account_created: true, employee_users_created: 0 })
