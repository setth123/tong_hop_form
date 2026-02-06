environment: source ~/projects/lucthuy/bin/activate

backend: cd web_local/backend, npm run start

frontend: cd web_local/frontend, http-server

proxy: cd web_local/backend, node proxy.js

telegram worker: cd web_local/backend/telegram_notify_py, python3 worker.py

ngrok: ngrok http 3000