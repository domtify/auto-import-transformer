import pkg from "../package.json" with { type: "json" }
import resolvePackagePath from "resolve-package-path"
import path from "path"
import { readdirSync } from "node:fs"
import c from "picocolors"
import { createConsola } from "consola"
import type { ConsolaInstance } from "consola"
import utils from "./utils.js"

import type {
  File,
  Program,
  Node,
  ImportDeclaration,
  StringLiteral,
  MemberExpression,
  Comment,
  CommentLine,
  CommentBlock,
} from "@babel/types"

const IGNORE_START = "domtify-ignore-start"
const IGNORE_END = "domtify-ignore-end"

// 定义选项接口
interface AutoImportTransformerOptions {
  /** 是否启用详细日志输出 */
  verbose?: boolean
}

const DEFAULT: Required<AutoImportTransformerOptions> = {
  verbose: false,
}

class AutoImportTransformer {
  private file: File
  private program: Program

  // 状态
  private hasRootImport = false
  private localRootNames = new Set<string>()
  private instanceMethods: Set<string>
  private utilityMethods: Set<string>
  private usedInstanceMethods = new Set<string>()
  private usedUtilityMethods = new Set<string>()
  private ignoreRanges: Array<{ start: number; end: number }> = []

  private importSources: Array<string> = ["domtify"]
  private methodsPath: string = "domtify/methods"
  private utilitiesPath: string = "domtify/utilities"

  private filename: string
  private options: Required<AutoImportTransformerOptions>

  private logger: ConsolaInstance

  constructor(
    file: File,
    filename: string,
    options: AutoImportTransformerOptions = {},
  ) {
    this.file = file
    this.program = file.program
    this.filename = filename
    this.options = {
      ...DEFAULT,
      ...options,
    }

    this.logger = createConsola({
      defaults: {
        tag: "@domtify/auto-import-transformer", // 每条日志前都会加上这个 tag
      },
      level: 3, // 控制输出等级
    })

    const pkgPath = resolvePackagePath("domtify", process.cwd()) || ""

    this.instanceMethods = new Set(
      readdirSync(`${path.dirname(pkgPath)}/dist/esm/methods`).map(
        (item) => path.parse(item).name,
      ),
    )
    this.utilityMethods = new Set(
      readdirSync(`${path.dirname(pkgPath)}/dist/esm/utilities`).map(
        (item) => path.parse(item).name,
      ),
    )

    // 初始化时收集忽略范围
    this.collectIgnoreRanges()
  }

  /**
   * 执行完整的转换流程
   */
  transform(): File {
    // 1. 分析导入
    this.analyzeImports()

    // 2. 如果没有根导入，直接返回
    if (!this.hasRootImport) {
      return this.file
    }

    // 3. 遍历收集方法使用
    this.traverseAndCollectMethods(this.program)

    // 4. 生成导入节点并插入
    const result = this.insertImportNodes()

    if (this.options.verbose) {
      this.logSummary()
    }

    return result
  }

  /**
   * 输出转换摘要
   */
  private logSummary(): void {
    if (
      this.usedInstanceMethods.size === 0 &&
      this.usedUtilityMethods.size === 0
    ) {
      this.logger.warn("No methods detected for auto-import.")
      return
    }

    this.logger.info("Auto-import summary:")

    if (this.usedInstanceMethods.size > 0) {
      this.logger.info(
        utils.indent(2, `methods(${this.usedInstanceMethods.size})`),
      )

      Array.from(this.usedInstanceMethods).forEach((method) => {
        this.logger.info(utils.indent(3, `- ${c.italic(method)}`))
      })
    }

    if (this.usedUtilityMethods.size > 0) {
      this.logger.info(
        utils.indent(2, `utilities(${this.usedUtilityMethods.size})`),
      )
      Array.from(this.usedUtilityMethods).forEach((utility) => {
        this.logger.info(utils.indent(3, `- ${c.italic(utility)}`))
      })
    }

    this.logger.success(
      `Finished auto-importing ${this.usedInstanceMethods.size + this.usedUtilityMethods.size} methods.`,
    )
  }

  /**
   * 获取节点位置信息（行号、列号）
   */
  private getNodeLocation(node: Node): { line: number; column: number } {
    // 这里需要根据你的文件结构来获取位置信息
    // 假设 this.file 有 loc 信息
    const loc = node.loc?.start || { line: 1, column: 0 }
    return {
      line: loc.line,
      column: loc.column + 1, // 通常列号从1开始
    }
  }

  /**
   * 记录详细的方法使用信息
   */
  private logMethodUsage(
    methodName: string,
    node: Node,
    type: "instance" | "utility",
  ): void {
    if (!this.options.verbose) return

    const location = this.getNodeLocation(node)

    const methodType =
      type === "instance" ? c.yellow(`[method]`) : c.blue(`[utility]`)

    this.logger.info(
      `${methodType} ${c.italic(methodName)} │ position: ${location.line}:${location.column}`,
    )
  }

  /**
   * 收集忽略范围
   */
  private collectIgnoreRanges(): void {
    const comments: Comment[] = this.file.comments || []

    let inIgnoreBlock = false
    let currentIgnoreStart = 0

    for (const comment of comments) {
      if (comment.type === "CommentLine") {
        const lineComment = comment as CommentLine
        if (lineComment.value.trim() === IGNORE_START) {
          this.logger.warn(`${IGNORE_START} should be used with block comments`)
        } else if (lineComment.value.trim() === IGNORE_END) {
          this.logger.warn(`${IGNORE_END} should be used with block comments`)
        }
      } else if (comment.type === "CommentBlock") {
        const blockComment = comment as CommentBlock
        const value = blockComment.value.trim()

        if (value === IGNORE_START) {
          if (inIgnoreBlock) {
            this.logger.warn(`Nested ${IGNORE_START} found`)
          }
          inIgnoreBlock = true
          currentIgnoreStart = blockComment.start || 0
        } else if (value === IGNORE_END) {
          if (!inIgnoreBlock) {
            this.logger.warn(`${IGNORE_END} without start`)
          } else {
            this.ignoreRanges.push({
              start: currentIgnoreStart,
              end: blockComment.end || 0,
            })
            inIgnoreBlock = false
          }
        }
      }
    }

    if (inIgnoreBlock) {
      this.logger.warn(`Unclosed ${IGNORE_START} found`)
    }
  }

  /**
   * 检查位置是否在忽略范围内
   */
  private isInIgnoreRange(node: Node): boolean {
    const start = node.start || 0
    const end = node.end || 0

    return this.ignoreRanges.some(
      (range) => start >= range.start && end <= range.end,
    )
  }

  /**
   * 分析导入信息
   */
  private analyzeImports(): void {
    for (const node of this.program.body) {
      if (node.type === "ImportDeclaration" && node.source) {
        const src = node.source.value
        if (this.importSources.includes(src)) {
          this.hasRootImport = true
          for (const s of node.specifiers || []) {
            this.localRootNames.add(s.local.name)
          }
        }
      }

      if (node.type === "VariableDeclaration") {
        for (const decl of node.declarations || []) {
          const init = decl.init
          if (
            init &&
            init.type === "CallExpression" &&
            init.callee.type === "Identifier" &&
            init.callee.name === "require" &&
            Array.isArray(init.arguments) &&
            init.arguments[0]?.type === "StringLiteral"
          ) {
            const reqSrc = (init.arguments[0] as StringLiteral).value

            if (this.importSources.includes(reqSrc)) {
              this.hasRootImport = true
              if (decl.id.type === "Identifier") {
                this.localRootNames.add(decl.id.name)
              }
            }
          }
        }
      }
    }

    if (this.hasRootImport && this.options.verbose) {
      const info = `@domtify/auto-import-transformer v${pkg.version}`
      this.logger.info(info)
      this.logger.info(`entry: ${c.blue(this.filename)}`)
    }
  }

  /**
   * 遍历并收集方法使用
   */
  private traverseAndCollectMethods(node: Node): void {
    if (!node || typeof node !== "object") return

    // 检查是否在忽略范围内
    if (this.isInIgnoreRange(node)) {
      return
    }

    // 策略1：成员表达式分析（主要策略）
    if (node.type === "MemberExpression") {
      const memberNode = node as MemberExpression

      let methodName: string | null = null

      // 提取方法名
      if (!memberNode.computed && memberNode.property.type === "Identifier") {
        // 点语法：.methodName
        methodName = memberNode.property.name
      } else if (
        memberNode.computed &&
        memberNode.property.type === "StringLiteral"
      ) {
        // 方括号访问：['methodName']
        methodName = memberNode.property.value
      }

      if (methodName) {
        // 检查是否是已知的实例方法
        if (this.instanceMethods.has(methodName)) {
          this.usedInstanceMethods.add(methodName)
          this.logMethodUsage(methodName, node, "instance")
        }
        // 检查是否是已知的工具方法
        if (this.utilityMethods.has(methodName)) {
          this.usedUtilityMethods.add(methodName)
          this.logMethodUsage(methodName, node, "utility")
        }
      }
    }

    // 策略2：字符串字面量匹配（补充策略）
    if (node.type === "StringLiteral") {
      const stringNode = node as StringLiteral
      const methodName = stringNode.value

      // 检查是否是已知的实例方法
      if (this.instanceMethods.has(methodName)) {
        this.usedInstanceMethods.add(methodName)
        this.logMethodUsage(methodName, node, "instance")
      }
      // 检查是否是已知的工具方法
      if (this.utilityMethods.has(methodName)) {
        this.usedUtilityMethods.add(methodName)
        this.logMethodUsage(methodName, node, "utility")
      }
    }

    // 递归处理子节点
    for (const key in node) {
      const child = (node as any)[key]
      if (Array.isArray(child)) {
        for (const c of child) this.traverseAndCollectMethods(c)
      } else {
        this.traverseAndCollectMethods(child)
      }
    }
  }

  /**
   * 生成并插入导入节点
   */
  private insertImportNodes(): File {
    const importNodes = this.generateImportNodes()

    if (importNodes.length === 0) {
      return this.file
    }

    // 找到插入位置（在所有导入语句之后）
    let insertIndex = 0
    for (let i = 0; i < this.program.body.length; i++) {
      const node = this.program.body[i]
      if (
        node.type !== "ImportDeclaration" &&
        !(
          node.type === "VariableDeclaration" &&
          node.declarations.some(
            (decl) =>
              decl.init?.type === "CallExpression" &&
              decl.init.callee.type === "Identifier" &&
              decl.init.callee.name === "require",
          )
        )
      ) {
        insertIndex = i
        break
      }
      insertIndex = i + 1
    }

    // 创建新的程序体
    const newBody = [
      ...this.program.body.slice(0, insertIndex),
      ...importNodes,
      ...this.program.body.slice(insertIndex),
    ]

    // 返回新的 File
    return {
      ...this.file,
      program: {
        ...this.program,
        body: newBody,
      },
    }
  }

  /**
   * 生成需要插入的 import 节点
   */
  private generateImportNodes(): ImportDeclaration[] {
    const existingMethods = new Set<string>()
    const existingUtilities = new Set<string>()

    for (const node of this.program.body) {
      if (node.type === "ImportDeclaration") {
        const src = node.source.value
        if (src.startsWith(this.methodsPath + "/")) {
          existingMethods.add(src.slice(this.methodsPath.length + 1))
        } else if (src.startsWith(this.utilitiesPath + "/")) {
          existingUtilities.add(src.slice(this.utilitiesPath.length + 1))
        }
      }
    }

    const addMethods = Array.from(this.usedInstanceMethods).filter(
      (m) => !existingMethods.has(m),
    )
    const addUtilities = Array.from(this.usedUtilityMethods).filter(
      (u) => !existingUtilities.has(u),
    )

    return [
      ...addMethods.map((m) => ({
        type: "ImportDeclaration",
        specifiers: [],
        source: { type: "StringLiteral", value: `${this.methodsPath}/${m}` },
      })),
      ...addUtilities.map((u) => ({
        type: "ImportDeclaration",
        specifiers: [],
        source: { type: "StringLiteral", value: `${this.utilitiesPath}/${u}` },
      })),
    ] as ImportDeclaration[]
  }
}

export default AutoImportTransformer
export type { AutoImportTransformerOptions }
