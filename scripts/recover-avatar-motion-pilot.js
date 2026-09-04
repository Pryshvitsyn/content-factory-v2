'use strict';
require('dotenv').config({quiet:true});
const args=process.argv.slice(2);const value=(name)=>args[args.indexOf(name)+1];const execution=value('--execution'),attempt=value('--attempt');
if(!execution||!attempt)throw new Error('Usage: npm run avatar:motion-pilot:recover -- --execution <id> --attempt <id>');
console.log('RECOVERY MODE: EXISTING PREDICTION ONLY');console.log('NEW PREDICTIONS ALLOWED: 0');console.log(`EXECUTION ID: ${execution}`);console.log(`ATTEMPT ID: ${attempt}`);
if(!process.env.REPLICATE_API_TOKEN){const error=new Error('REPLICATE_API_TOKEN is required only to recover the existing prediction');error.code='REPLICATE_TOKEN_REQUIRED';throw error;}
throw new Error('Run this command through the configured local Dashboard runtime recovery endpoint; it never calls generate().');
