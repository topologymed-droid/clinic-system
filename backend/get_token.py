from google_auth_oauthlib.flow import InstalledAppFlow
import json

SCOPES = ['https://www.googleapis.com/auth/calendar']

flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
creds = flow.run_local_server(port=8765, open_browser=True)

with open('token.json', 'w') as f:
    f.write(creds.to_json())

print("\n✅ token.json 已儲存！")
print(creds.to_json())
