// kuromoji の辞書（IPADIC）をバイナリに埋め込み、kuromojin が参照するディレクトリを指定する。
//
// kuromojin は、デフォルトでは node_modules の kuromoji のディレクトリから辞書を読み込むため、
// bun build --compile で作成したバイナリは、ビルドした環境以外では辞書を読み込めない。
// 辞書の各ファイルを with { type: "file" } で埋め込み、埋め込み先のディレクトリを環境変数 KUROMOJIN_DIC_PATH に設定する。
// kuromoji はディレクトリとファイル名を連結して読み込むため、ビルド時に --asset-naming="[name].[ext]" を指定し、
// 埋め込み後のファイル名を変更しない。
import { dirname } from "node:path";
import base from "../node_modules/kuromoji/dict/base.dat.gz" with { type: "file" };
import cc from "../node_modules/kuromoji/dict/cc.dat.gz" with { type: "file" };
import check from "../node_modules/kuromoji/dict/check.dat.gz" with { type: "file" };
import tid from "../node_modules/kuromoji/dict/tid.dat.gz" with { type: "file" };
import tidMap from "../node_modules/kuromoji/dict/tid_map.dat.gz" with { type: "file" };
import tidPos from "../node_modules/kuromoji/dict/tid_pos.dat.gz" with { type: "file" };
import unk from "../node_modules/kuromoji/dict/unk.dat.gz" with { type: "file" };
import unkChar from "../node_modules/kuromoji/dict/unk_char.dat.gz" with { type: "file" };
import unkCompat from "../node_modules/kuromoji/dict/unk_compat.dat.gz" with { type: "file" };
import unkInvoke from "../node_modules/kuromoji/dict/unk_invoke.dat.gz" with { type: "file" };
import unkMap from "../node_modules/kuromoji/dict/unk_map.dat.gz" with { type: "file" };
import unkPos from "../node_modules/kuromoji/dict/unk_pos.dat.gz" with { type: "file" };

/** 埋め込んだ辞書のファイル。インポートを参照することで、バンドルから除去されないようにする */
export const DICTIONARY_FILES = [
  base,
  cc,
  check,
  tid,
  tidMap,
  tidPos,
  unk,
  unkChar,
  unkCompat,
  unkInvoke,
  unkMap,
  unkPos,
];

process.env.KUROMOJIN_DIC_PATH = dirname(base);
