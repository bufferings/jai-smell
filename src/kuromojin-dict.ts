// kuromojin の辞書（IPADIC）をバイナリに埋め込み、kuromojin が読み込む辞書のパスを指定する。
//
// kuromojin は、デフォルトでは node_modules の kuromojin のディレクトリから辞書を読み込む。
// そのため、bun build --compile で作成したバイナリは、ビルドした環境以外では辞書を読み込めない。
// 辞書のファイルを with { type: "file" } で埋め込み、埋め込み後のパスを環境変数 KUROMOJIN_DIC_PATH に設定する。
// kuromojin は、パスの末尾が .dict の場合に、kuromojin の形式の 1 つのファイルとして読み込む。
import dictionary from "../node_modules/kuromojin/dict/kuromojin.dict" with { type: "file" };

process.env.KUROMOJIN_DIC_PATH = dictionary;
