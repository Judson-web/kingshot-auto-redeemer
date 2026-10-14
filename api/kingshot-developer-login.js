import developerLogin from "../lib/developer-login.js";

export default async function handler(req, res) {
  return developerLogin(req, res);
}
