import data from "../../lib/admin-data.js";
import login from "../../lib/admin-login.js";
export default async function handler(req,res){const pathname=new URL(req.url||"/","http://localhost").pathname;const marker="/api/admin-tools/";const p=pathname.startsWith(marker)?pathname.slice(marker.length).replace(/^\/+|\/+$/g,""):"";if(p==="login")return login(req,res);if(p==="developer-login")return res.status(404).json({error:"Not found."});return data(req,res)}
