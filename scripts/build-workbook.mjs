import fs from 'node:fs/promises';
import {build} from 'esbuild';

await fs.mkdir('dist/vendor', {recursive:true});
await build({
  stdin:{
    contents:"export {default as readXlsx} from 'read-excel-file/universal'; export {unzipSync} from 'fflate';",
    sourcefile:'trace-x-workbook-vendor.js',
    resolveDir:process.cwd()
  },
  outfile:'dist/vendor/workbook.js',
  bundle:true, minify:true, platform:'browser', format:'esm', target:'es2020', legalComments:'eof'
});
for (const name of ['read-excel-file', 'fflate', 'saxen']) {
  await fs.copyFile('node_modules/'+name+'/LICENSE', 'dist/vendor/'+name+'-LICENSE.txt');
}
console.log('Bundled the offline XLSX reader.');
