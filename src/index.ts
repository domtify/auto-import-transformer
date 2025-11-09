import type { File } from "@babel/types"
import type { Transformer } from "unplugin-ast"
import AutoImportTransformer from "./AutoImportTransformer.js"
import type { AutoImportTransformerOptions } from "./AutoImportTransformer.js"

export function autoImportTransformer(
  options: AutoImportTransformerOptions,
): Transformer<File> {
  return {
    onNode: (node) => node.type === "File",

    transform(file: File, code, cxt): File {
      const transformer = new AutoImportTransformer(file, cxt.id, options)
      return transformer.transform()
    },
  }
}
