const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");


const app = express();

app.use("/n8n", createProxyMiddleware({ target: "http://localhost:5680" }));
app.use("/backend", createProxyMiddleware({ target: "http://localhost:4000" }));
app.use("/", createProxyMiddleware({ target: "http://localhost:8080" }));



app.listen(3000, () => console.log("Gateway on 3000"));
