// Backwards-compatible alias for historical path/name typos.
// Some installs still try to load:
//   dist/nodes/RunDatsheesh/RunDatsheesh.node.js
// n8n expects the exported class name to match the filename ("RunDatsheesh").
export { RunDatSeesh as RunDatsheesh } from "../RunDatSeesh/RunDatSeesh.node";

