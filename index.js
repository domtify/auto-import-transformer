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
      const methods = new Set()
      const utilities = new Set()

      let hasRootImport = false
      const localRootNames = new Set()

      // 跟踪实例变量（存储domtify实例的变量名）
      const instanceVars = new Set()

      // 收集导入信息
      for (const node of program.body) {
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
                localRootNames.add(s.local.name)
              }
            })
          }
        }

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
        return program
      }

      // 第一步遍历 - 识别实例变量
      function collectInstanceVariables(node) {
        if (!node || typeof node !== "object") return

        // 识别变量声明中的domtify实例
        if (node.type === "VariableDeclaration") {
          for (const decl of node.declarations || []) {
            if (decl.init && decl.init.type === "CallExpression") {
              const callResult = analyzeCallExpression(decl.init)
              if (callResult.isDomtifyInstance) {
                // 这个变量存储了domtify实例
                if (decl.id.type === "Identifier") {
                  instanceVars.add(decl.id.name)
                }
              }
            }
          }
        }

        // 识别赋值表达式中的domtify实例
        if (node.type === "AssignmentExpression") {
          if (node.right.type === "CallExpression") {
            const callResult = analyzeCallExpression(node.right)
            if (
              callResult.isDomtifyInstance &&
              node.left.type === "Identifier"
            ) {
              instanceVars.add(node.left.name)
            }
          }
        }

        for (const key in node) {
          if (!Object.prototype.hasOwnProperty.call(node, key)) continue
          const child = node[key]
          if (Array.isArray(child)) child.forEach(collectInstanceVariables)
          else collectInstanceVariables(child)
        }
      }

      // 分析调用表达式，判断是否返回domtify实例
      function analyzeCallExpression(callNode) {
        if (!callNode || callNode.type !== "CallExpression")
          return { isDomtifyInstance: false }

        let callee = callNode.callee

        // 如果是直接调用：d(selector)
        if (callee.type === "Identifier" && localRootNames.has(callee.name)) {
          return { isDomtifyInstance: true }
        }

        // 如果是链式调用：d(selector).method()
        if (callee.type === "MemberExpression") {
          let object = callee.object

          // 解开链式调用，找到根对象
          while (
            object.type === "CallExpression" ||
            object.type === "MemberExpression"
          ) {
            if (object.type === "CallExpression") {
              object = object.callee
            } else if (object.type === "MemberExpression") {
              object = object.object
            }
          }

          if (
            object.type === "Identifier" &&
            (localRootNames.has(object.name) || instanceVars.has(object.name))
          ) {
            return { isDomtifyInstance: true }
          }
        }

        return { isDomtifyInstance: false }
      }

      // 收集方法调用
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

      function collectFromCall(callNode) {
        if (!callNode || callNode.type !== "CallExpression") return

        let callee = callNode.callee
        const chain = []
        let encounteredInnerCall = false

        // 收集成员表达式链
        while (callee) {
          if (callee.type === "MemberExpression") {
            chain.push(callee)
            callee = callee.object
            continue
          } else if (callee.type === "CallExpression") {
            encounteredInnerCall = true
            callee = callee.callee
            continue
          }
          break
        }

        // 检查是否是domtify相关调用
        if (callee && callee.type === "Identifier") {
          const isRootCall = localRootNames.has(callee.name)
          const isInstanceCall = instanceVars.has(callee.name)

          if (isRootCall || isInstanceCall) {
            if (chain.length === 0) return

            if (encounteredInnerCall || isInstanceCall) {
              // 实例方法调用
              for (const member of chain) {
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
              // 静态工具函数调用
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
      }

      // 执行收集过程
      collectInstanceVariables(program)
      traverseNode(program)

      if (methods.size === 0 && utilities.size === 0) return program

      // 检查已存在的imports
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

      // 生成import节点
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

      // 插入到合适位置
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
