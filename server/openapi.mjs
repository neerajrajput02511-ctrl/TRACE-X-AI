const error={description:'Request rejected',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}};
const json=(schema={type:'object'})=>({content:{'application/json':{schema}}});
const ok=(description,schema)=>({description,...json(schema)});
const body=schema=>({required:true,...json(schema)});
const params=names=>names.map(name=>({name,in:'query',schema:{type:'string'}}));
const pathParameter=name=>({name,in:'path',required:true,schema:{type:'string'}});
const action=(summary,response,extras={})=>({summary,...extras,responses:{200:response,400:error,401:error,403:error,404:error,409:error,413:error,415:error,429:error,...extras.responses}});
const ref=name=>({$ref:'#/components/schemas/'+name});
const id=[pathParameter('id')];
const caseResult=ok('Current case with source manifests, normalized evidence, findings, audit and access metadata.',ref('Case'));
const sourcePath=[...id,pathParameter('fileId')];
const pdf={description:'Reviewer-approved current case report',content:{'application/pdf':{schema:{type:'string',format:'binary'}}}};

export const openApiDocument={
  openapi:'3.1.0',
  info:{title:'TRACE-X AI shared investigation API',version:'2.0.0',description:'Same-origin team API. All protected routes enforce server session, unit and case access.'},
  security:[{teamSession:[]}],
  paths:{
    '/healthz':{get:{security:[],summary:'Liveness only',responses:{200:ok('Healthy')}}},
    '/api/login':{post:action('Start an authenticated session',ok('Session issued',ref('Session')),{security:[],requestBody:body({type:'object',required:['username','password'],properties:{username:{type:'string'},password:{type:'string',format:'password'}}})})},
    '/api/logout':{post:action('Revoke this session',ok('Signed out'))},
    '/api/session':{get:action('Get active user, role and unit',ok('Session',ref('Session')))},
    '/api/intent':{post:action('Classify an already masked case question with the configured local model',ok('Allowlisted intent or null',{type:'object',properties:{intent:{type:['string','null']}}}),{requestBody:body({type:'object',required:['maskedQuestion'],properties:{maskedQuestion:{type:'string',maxLength:400}}})})},
    '/api/cases':{get:action('List assigned and managed cases',ok('Accessible cases',{type:'array',items:ref('Case')}))},
    '/api/cases/{id}':{parameters:id,get:action('Open authorized case',caseResult),put:action('Create or save a case revision',caseResult,{requestBody:body(ref('Case')),responses:{201:caseResult}})},
    '/api/cases/{id}/details':{parameters:id,patch:action('Update case notes, scope or archive status',caseResult,{requestBody:body(ref('CaseMetadata'))})},
    '/api/cases/{id}/assignments':{parameters:id,get:action('List case assignees',ok('Assignees',{type:'array',items:{type:'object'}})),put:action('Replace same-unit assignments',caseResult,{requestBody:body({type:'object',required:['usernames'],properties:{usernames:{type:'array',items:{type:'string'}}}})})},
    '/api/cases/{id}/assignment-candidates':{parameters:id,get:action('List unit accounts eligible for assignment',ok('Unit account directory',{type:'array',items:ref('Account')}))},
    '/api/cases/{id}/records':{parameters:id,get:action('Search indexed normalized evidence',ok('Page of evidence',{type:'object',properties:{rows:{type:'array',items:{type:'object'}},total:{type:'integer'},offset:{type:'integer'},limit:{type:'integer'}}}),{parameters:[...params(['q','number','from','to','operator','imei','tower','ip','protocol','session','kind','port','sort']),{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:200,default:50}},{name:'offset',in:'query',schema:{type:'integer',minimum:0,default:0}}]})},
    '/api/cases/{id}/uploads':{parameters:id,post:action('Preview field mappings or commit a versioned import',ok('Mapping preview or updated case'),{requestBody:{required:true,content:{'multipart/form-data':{schema:{type:'object',required:['file'],properties:{file:{type:'string',format:'binary',description:'CSV, TSV, TXT or single-sheet XLSX up to 10 MiB'},preview:{type:'string',enum:['true','false']},options:{type:'string',description:'JSON string with revision, optional columnMap and timezoneOffsetMinutes'}}}}}}})},
    '/api/cases/{id}/sources/{fileId}':{parameters:sourcePath,get:action('Download verified original evidence',{description:'Original uploaded bytes',content:{'application/octet-stream':{schema:{type:'string',format:'binary'}}}})},
    '/api/cases/{id}/sources/{fileId}/verify':{parameters:sourcePath,post:action('Compare original bytes with recorded SHA-256',ok('Integrity result',{type:'object',properties:{ok:{type:'boolean'},expected:{type:'string'},actual:{type:['string','null']}}}))},
    '/api/cases/{id}/leads/{leadId}':{parameters:[...id,pathParameter('leadId')],patch:action('Change an evidence-backed lead state',caseResult,{requestBody:body({type:'object',required:['status'],properties:{status:{enum:['new','in_review','cleared','dismissed']},reviewer:{type:'string'}}})})},
    '/api/cases/{id}/activity':{parameters:id,post:action('Record a case-scoped source or record view',caseResult,{requestBody:body({type:'object',required:['action','ref'],properties:{action:{enum:['Source viewed','Record viewed']},ref:{type:'string'}}})})},
    '/api/cases/{id}/report.pdf':{parameters:id,get:action('Download approved case report',pdf)},
    '/api/cases/{id}/reviews/{version}':{parameters:[...id,pathParameter('version')],get:action('Read a historical signed revision',caseResult)},
    '/api/admin/users':{get:action('List unit users',ok('Unit directory',{type:'array',items:ref('Account')})),post:{...action('Provision a new user in the unit',ok('Account created',ref('Account')),{requestBody:body({type:'object',required:['username','password','role'],properties:{username:{type:'string'},password:{type:'string',minLength:12,format:'password'},role:ref('Role')}})}),responses:{201:ok('Account created',ref('Account')),400:error,401:error,403:error,409:error}}},
    '/api/admin/users/{username}':{parameters:[pathParameter('username')],patch:action('Change role or disable another account',ok('Updated account'),{requestBody:body({type:'object',properties:{role:ref('Role'),active:{type:'boolean'}}})})},
    '/api/admin/health':{get:action('Read schema version, active counts and unit account audit',ok('Unit status'))}
  },
  components:{
    securitySchemes:{teamSession:{type:'apiKey',in:'cookie',name:'tx_session'}},
    schemas:{
      Error:{type:'object',required:['error'],properties:{error:{type:'string'}}},
      Role:{type:'string',enum:['investigator','reviewer','admin']},
      Session:{type:'object',required:['username','role','unit'],properties:{username:{type:'string'},role:ref('Role'),unit:{type:'string'}}},
      Account:{type:'object',required:['username','role','active'],properties:{username:{type:'string'},role:ref('Role'),active:{type:'boolean'},unit:{type:'string'}}},
      Case:{type:'object',required:['id','name','files','records','towers'],properties:{id:{type:'string'},name:{type:'string'},revision:{type:'integer'},contentVersion:{type:'integer'},metadata:ref('CaseMetadata'),files:{type:'array',items:{type:'object'}},records:{type:'array',items:{type:'object'}},towers:{type:'array',items:{type:'object'}}}},
      CaseMetadata:{type:'object',properties:{notes:{type:'string',maxLength:16000},summary:{type:'string',maxLength:2000},status:{type:'string',enum:['open','in_review','closed','archived']},scopeStart:{type:'string',description:'YYYY-MM-DD in IST, or blank'},scopeEnd:{type:'string',description:'YYYY-MM-DD in IST, or blank'}}}
    }
  }
};
