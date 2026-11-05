import { fullSync } from "../lib/zoho/sync";
fullSync().then((d) => { console.log(d); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
