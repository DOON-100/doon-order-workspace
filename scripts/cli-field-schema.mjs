// Static input descriptions only; server refinements and permissions remain authoritative.
export const field=schema=>{
  const required=!schema.isOptional(),nullable=schema.isNullable();let current=schema;
  while(['ZodEffects','ZodOptional','ZodNullable','ZodDefault','ZodBranded'].includes(current._def.typeName))current=current._def.schema||current._def.innerType||current._def.type;
  const def=current._def,name=def.typeName;let result;
  if(name==='ZodString')result={type:'string'};
  else if(name==='ZodNumber')result={type:'number'};
  else if(name==='ZodBoolean')result={type:'boolean'};
  else if(name==='ZodRecord')result={type:'json'};
  else if(name==='ZodObject')result={type:'object',properties:Object.fromEntries(Object.entries(current.shape).map(([key,value])=>[key,field(value)]))};
  else if(name==='ZodArray')result={type:'array',items:field(def.type),...(def.minLength?{min:def.minLength.value}:{}),...(def.maxLength?{max:def.maxLength.value}:{})};
  else if(name==='ZodEnum')result={type:'string',enum:current.options};
  else if(name==='ZodLiteral')result={type:typeof def.value,enum:[def.value]};
  else if(name==='ZodUnknown'||name==='ZodAny')result={type:'json'};
  else if(name==='ZodUnion'){
   const options=def.options.map(field);if(!options.every(value=>value.type==='string'))return {type:'json',...(required?{required:true}:{})};
   // Date-or-empty input. Date validation remains authoritative on the server.
   result={type:'string'};
  }else throw Error('Unsupported schema type: '+name);
  for(const check of def.checks||[])if(check.kind==='min')result.min=check.value;else if(check.kind==='max')result.max=check.value;else if(check.kind==='int')result.integer=true;
  return {...result,...(required?{required:true}:{}),...(nullable?{nullable:true}:{})};
 };
