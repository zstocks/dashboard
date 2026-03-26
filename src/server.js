const http = require('http');

const PORT = 3000;
const APP_NAME = 'dashboard';

const server = http.createServer((req, res) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h1>${APP_NAME}</h1><p>Up and running.</p>`);
    } else if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', app: APP_NAME }));
    } else {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404</h1><p>Page not found.</p>');
    }
});

server.listen(PORT, () => {
    console.log(`${APP_NAME} listening on port ${PORT}`);
});
