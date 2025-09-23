const DEFAULT = {
  rootNames: ["$"],
  importPath: "domtify/methods",
}

function autoImportTransformer(options = {}) {
  const { rootNames, importPath } = { ...DEFAULT, ...options }

  return {
    onNode(node) {
      return node.type === "Program"
    },

    transform(program) {
      const usedMethods = new Set()

      function traverseNode(node) {
        if (!node || typeof node !== "object") return

        if (node.type === "CallExpression") {
          collectMethodsFromCall(node)
        }

        for (const key in node) {
          if (!node.hasOwnProperty(key)) continue
          const child = node[key]
          if (Array.isArray(child)) child.forEach(traverseNode)
          else traverseNode(child)
        }
      }

      function collectMethodsFromCall(callNode) {
        if (!callNode || callNode.type !== "CallExpression") return

        let callee = callNode.callee
        const chain = []

        // 收集链条上的所有 MemberExpression
        while (callee) {
          if (callee.type === "MemberExpression") {
            chain.unshift(callee)
            callee = callee.object
          } else if (callee.type === "CallExpression") {
            callee = callee.callee
          } else {
            break
          }
        }

        // 判断最左侧是否是 root
        if (
          callee &&
          callee.type === "Identifier" &&
          rootNames.includes(callee.name)
        ) {
          // 收集链条中所有方法
          for (const member of chain) {
            if (!member.computed && member.property.type === "Identifier") {
              usedMethods.add(member.property.name)
            } else if (
              member.computed &&
              member.property.type === "StringLiteral"
            ) {
              usedMethods.add(member.property.value)
            }
          }
        }
      }

      traverseNode(program)

      if (usedMethods.size === 0) return program

      // 去掉已存在的 import
      const already = new Set()
      for (const node of program.body) {
        if (
          node.type === "ImportDeclaration" &&
          node.source &&
          typeof node.source.value === "string"
        ) {
          const src = node.source.value
          if (src.startsWith(importPath + "/")) {
            already.add(src.slice(importPath.length + 1))
          }
        }
      }

      const toAdd = Array.from(usedMethods).filter((m) => !already.has(m))
      if (toAdd.length === 0) return program

      // 创建 import AST 节点
      const importNodes = toAdd.map((m) => ({
        type: "ImportDeclaration",
        specifiers: [],
        source: { type: "StringLiteral", value: `${importPath}/${m}` },
      }))

      // 插入到最后一个 import 后
      let insertIndex = program.body.findIndex(
        (n) => n.type !== "ImportDeclaration",
      )
      if (insertIndex === -1) insertIndex = program.body.length
      program.body.splice(insertIndex, 0, ...importNodes)

      return program
    },
  }
}

export { autoImportTransformer }
