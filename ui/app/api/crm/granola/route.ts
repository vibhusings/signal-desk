// Retired: Attio delivery credentials must not authorize legacy Granola intake.
export async function POST(_request:Request){
 return Response.json({error:'Granola delivery is disabled. Configure Attio meeting delivery in CRM → Capture & settings.'},{status:410});
}
