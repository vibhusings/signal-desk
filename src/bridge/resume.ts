import type { ToolCall } from '../reply/tools.js';

export type ResumeUpload = {filename:string;mimeType:string;bytes:Buffer};

export async function uploadResume(call:ToolCall, upload:ResumeUpload, fetcher:typeof fetch=fetch) {
  const requested=await call('request_file_upload',{filename:upload.filename,mime_type:upload.mimeType,size_bytes:upload.bytes.length});
  const fileId=typeof requested?.file_id==='string'?requested.file_id:'';
  const uploadUrl=typeof requested?.upload_url==='string'?requested.upload_url:'';
  if(!fileId||!/^https:\/\//.test(uploadUrl))throw Error('Slashy did not provide a valid resume upload URL.');
  const form=new FormData();
  form.append('file',new Blob([new Uint8Array(upload.bytes)],{type:upload.mimeType}),upload.filename);
  const response=await fetcher(uploadUrl,{method:'PUT',body:form,redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`Resume upload failed (${response.status}).`);
  const status=await call('check_upload_status',{file_id:fileId});
  if(!/uploaded/i.test(JSON.stringify(status)))throw Error('Slashy did not confirm the resume upload.');
  return fileId;
}
