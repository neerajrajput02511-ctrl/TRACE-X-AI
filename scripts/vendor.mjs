import fs from 'node:fs/promises';
const vendors={
  'cytoscape.js':'cytoscape/dist/cytoscape.esm.min.mjs',
  'cytoscape-LICENSE':'cytoscape/LICENSE',
  'leaflet.js':'leaflet/dist/leaflet-src.esm.js',
  'leaflet.css':'leaflet/dist/leaflet.css',
  'leaflet-LICENSE':'leaflet/LICENSE'
};
await fs.mkdir('dist/vendor',{recursive:true});
for(const [to,from] of Object.entries(vendors)){
  const target=/LICENSE$/.test(to)?to+'.txt':to;
  await fs.copyFile('node_modules/'+from,'dist/vendor/'+target);
}
await fs.cp('node_modules/leaflet/dist/images','dist/vendor/images',{recursive:true});
console.log('Bundled Cytoscape.js and Leaflet for network-free use.');
