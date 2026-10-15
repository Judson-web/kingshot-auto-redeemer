export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Allow","GET, DELETE");
  return res.status(410).json({
    error:"Legacy passkey administration has been retired.",
    login:"discord",
    signInUrl:"/dev"
  });
}
