// Keep campaign/research associations independent of the recent activity page.
export const campaignLinksSql = `
 SELECT json_extract(outcome.value, '$.id') AS recordId,
        json_extract(job.payload, '$.companyId') AS companyId
 FROM outreach_jobs AS job, json_each(job.result, '$.outcomes') AS outcome
 WHERE job.owner_id = ? AND job.action = 'launch'
   AND json_extract(outcome.value, '$.id') IS NOT NULL
   AND json_extract(job.payload, '$.companyId') IS NOT NULL
 ORDER BY job.created_at ASC
`;
