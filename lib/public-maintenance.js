const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
export default async function publicMaintenance(req,res){
 res.setHeader("Cache-Control","no-store, max-age=0");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET")return res.status(405).setHeader("Allow","GET").json({error:"Method not allowed."});
 if(!SUPABASE_KEY)return res.status(503).json({error:"Maintenance status service is not configured."});
 try{
  const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/kingshot_public_maintenance",{method:"POST",headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY,"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(8000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error("Maintenance status query failed ("+response.status+").");
  const state=Array.isArray(data)?data[0]:data;
  if(!state||typeof state.maintenance_enabled!=="boolean")throw new Error("Maintenance status response was invalid.");
  return res.status(200).json({maintenanceEnabled:state.maintenance_enabled,message:String(state.maintenance_message||"We are performing maintenance right now. Please check back shortly."),endsAt:state.ends_at||null,updatedAt:state.updated_at||null});
 }catch(error){
  console.error("Public maintenance status check failed:",error instanceof Error?error.message:"unknown error");
  return res.status(503).json({error:"Maintenance status is temporarily unavailable."});
 }
}
