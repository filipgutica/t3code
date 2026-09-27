// This command runs inside the fresh VM; paths and owner are supplied by the fixed launcher.
export const provisionScript = String.raw`
const fs=require('node:fs');const crypto=require('node:crypto');const cp=require('node:child_process');
const {pipeline}=require('node:stream/promises');const {Readable}=require('node:stream');
(async()=>{
 const [url,expected,destination,stateDirectory,owner]=process.argv.slice(1);
 const response=await fetch(url,{signal:AbortSignal.timeout(90000)});
 if(!response.ok||!response.body)throw Error('Bundle download failed');
 const file=destination+'.tar.gz';
 await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(file));
 const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
 if(hash.digest('hex')!==expected)throw Error('Bundle checksum mismatch');
 fs.mkdirSync(destination,{recursive:true});
 cp.execFileSync('tar',['--extract','--gzip','--file',file,'--directory',destination]);
 fs.unlinkSync(file);
 fs.mkdirSync(stateDirectory,{recursive:true,mode:0o700});
 fs.writeFileSync(stateDirectory+'/.workbench-preview-owned','workbench-preview-v1\n');
 cp.execFileSync('chown',['-R',owner,stateDirectory]);
})().catch(()=>process.exit(1));
`;
