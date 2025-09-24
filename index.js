function autoImportTransformer() {
  // 导入路径
  const importSources = ["domtify"]
  // 方法导入路径
  const methodsPath = "domtify/methods"
  // 助手路径
  const utilitiesPath = "domtify/utilities"

  return {
    onNode(node) {
      return node.type === "Program"
    },

    transform(program) {
      // 最终要导入的两个集合
      const methods = new Set()
      const utilities = new Set()

      // 检查文件是否真的导入了目标模块 (import 或 require)
      let hasRootImport = false
      // 从导入中收集本地 root 名称（例如 import $ from 'domtify' -> '$'）
      const localRootNames = new Set()

      for (const node of program.body) {
        // import ... from 'domtify'
        if (
          node.type === "ImportDeclaration" &&
          node.source &&
          typeof node.source.value === "string"
        ) {
          const src = node.source.value
          if (importSources.includes(src)) {
            hasRootImport = true
            ;(node.specifiers || []).forEach((s) => {
              if (s && s.local && s.local.name) {
                // default/namespace/named imports 本地名字都加入识别集合
                localRootNames.add(s.local.name)
              }
            })
          }
        }

        // const $ = require('domtify')
        if (node.type === "VariableDeclaration") {
          for (const decl of node.declarations || []) {
            if (
              decl.init &&
              decl.init.type === "CallExpression" &&
              decl.init.callee &&
              decl.init.callee.type === "Identifier" &&
              decl.init.callee.name === "require" &&
              Array.isArray(decl.init.arguments) &&
              decl.init.arguments[0] &&
              decl.init.arguments[0].type === "StringLiteral"
            ) {
              const reqSrc = decl.init.arguments[0].value
              if (importSources.includes(reqSrc)) {
                hasRootImport = true
                if (decl.id && decl.id.type === "Identifier") {
                  localRootNames.add(decl.id.name)
                }
              }
            }
          }
        }
      }

      if (!hasRootImport) {
        // 没有从目标模块导入，直接返回不处理
        return program
      }

      // 遍历 AST，收集方法/工具函数
      function traverseNode(node) {
        if (!node || typeof node !== "object") return

        if (node.type === "CallExpression") {
          collectFromCall(node)
        }

        for (const key in node) {
          if (!Object.prototype.hasOwnProperty.call(node, key)) continue
          const child = node[key]
          if (Array.isArray(child)) child.forEach(traverseNode)
          else traverseNode(child)
        }
      }

      /**
       * 对某个 CallExpression 收集信息
       * 区分两类场景：
       *  - 实例方法链：$(...).a().b()  => 从 methodsPath 导入 a、b
       *  - 静态工具：$.isFunction(...) => 从 utilitiesPath 导入 isFunction
       */
      function collectFromCall(callNode) {
        if (!callNode || callNode.type !== "CallExpression") return

        let callee = callNode.callee
        const chain = [] // 收集 MemberExpression 链（从左到右）
        let encounteredInnerCall = false // 表示链内在到达 root 之前遇到过 CallExpression（即 $(...) 的情况）

        // 把链中所有 MemberExpression 收集进 chain（顺序左->右）
        while (callee) {
          if (callee.type === "MemberExpression") {
            // push 到 chain 末尾，使 chain[0] 为最左侧 member，chain[last] 为最外层 member
            chain.push(callee)
            callee = callee.object
            continue
          } else if (callee.type === "CallExpression") {
            // 说明链里出现了 call，比如 $(...) 或者前面有 .a() 之类
            encounteredInnerCall = true
            callee = callee.callee // 继续向左找
            continue
          }
          break
        }

        // callee 现在是最左侧的非 Member/Call 节点，如果它是 Identifier 并且在 localRootNames 中，则是我们要处理的链
        if (
          callee &&
          callee.type === "Identifier" &&
          localRootNames.has(callee.name)
        ) {
          if (chain.length === 0) return // 没有 member 表达式则无需处理

          if (encounteredInnerCall) {
            // $(...) 的场景：把链上所有成员都当作实例方法（addClass, css, ...）
            for (const member of chain) {
              // member.property 可能是 Identifier 或 StringLiteral（computed）
              if (
                !member.computed &&
                member.property &&
                member.property.type === "Identifier"
              ) {
                methods.add(member.property.name)
              } else if (
                member.computed &&
                member.property &&
                member.property.type === "StringLiteral"
              ) {
                methods.add(member.property.value)
              }
            }
          } else {
            // $.xxx 的场景（静态助手函数）
            // 只取外层成员（最后一个 member）的属性名作为工具函数名
            const outer = chain[chain.length - 1]
            if (!outer) return
            if (
              !outer.computed &&
              outer.property &&
              outer.property.type === "Identifier"
            ) {
              utilities.add(outer.property.name)
            } else if (
              outer.computed &&
              outer.property &&
              outer.property.type === "StringLiteral"
            ) {
              utilities.add(outer.property.value)
            }
          }
        }
      }

      traverseNode(program)

      if (methods.size === 0 && utilities.size === 0) return program

      // 检查已存在的 imports，避免重复插入
      const existingMethods = new Set()
      const existingUtilities = new Set()
      for (const node of program.body) {
        if (
          node.type === "ImportDeclaration" &&
          node.source &&
          typeof node.source.value === "string"
        ) {
          const src = node.source.value
          if (src.startsWith(methodsPath + "/")) {
            existingMethods.add(src.slice(methodsPath.length + 1))
          } else if (src.startsWith(utilitiesPath + "/")) {
            existingUtilities.add(src.slice(utilitiesPath.length + 1))
          }
        }
      }

      const addMethods = Array.from(methods).filter(
        (m) => !existingMethods.has(m),
      )
      const addUtilities = Array.from(utilities).filter(
        (u) => !existingUtilities.has(u),
      )
      if (addMethods.length === 0 && addUtilities.length === 0) return program

      // 生成 import AST 节点（side-effect imports）
      const importNodes = [
        ...addMethods.map((m) => ({
          type: "ImportDeclaration",
          specifiers: [],
          source: { type: "StringLiteral", value: `${methodsPath}/${m}` },
        })),
        ...addUtilities.map((u) => ({
          type: "ImportDeclaration",
          specifiers: [],
          source: { type: "StringLiteral", value: `${utilitiesPath}/${u}` },
        })),
      ]

      // 插入到最后一个现有 import 之后（如果没有 import 就插到文件头）
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
