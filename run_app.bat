@echo off
echo Starting SEC-DIA Explorer Web Studio...
start http://localhost:3000
npm run preview -- --port 3000 --host
pause
