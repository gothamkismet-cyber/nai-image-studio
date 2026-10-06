// 把 256x256 PNG 包装为单图 ICO（Vista+ 支持 PNG 压缩条目）；用脚本自身位置定位，避开中文 cwd 编码问题
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const build = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "build");
const png = readFileSync(path.join(build, "icon.png"));
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
header.writeUInt8(0, 6); // width 256 -> 0
header.writeUInt8(0, 7); // height 256 -> 0
header.writeUInt8(0, 8); // palette
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bpp
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18); // offset

writeFileSync(path.join(build, "icon.ico"), Buffer.concat([header, png]));
console.log("icon.ico created,", png.length + 22, "bytes");
