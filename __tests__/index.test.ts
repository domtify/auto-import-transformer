import { describe, it, expect } from "vitest"
import { parse } from "@babel/parser"
import { generate } from "@babel/generator"
import { autoImportTransformer } from "../src/index.js"
import escapeStringRegexp from "escape-string-regexp"
import type { Program, File } from "@babel/types"

function runTransform(code: string): string {
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  })

  const transformer = autoImportTransformer({
    verbose: true,
  })

  // 模拟插件的 context
  const context = { id: `test-${Math.random()}.js` }

  // 调用 transform
  const result = transformer.transform(ast as File, code, context)

  const program =
    typeof result === "object" && result && "type" in result
      ? (result as Program)
      : ast.program

  return generate(program).code
}

describe("index", () => {
  it("自动导入原型方法", () => {
    const code = `
    import d from "domtify"
    d('.foo').addClass(".foo")
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/addClass"')
  })

  it("当使用 domtify 实例 时，应自动导入其实例方法", () => {
    const code = `
      import d from "domtify"
      const el = d(".foo")
      el.parent()
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/parent"')
  })

  it("如果已存在相同的导入，则不应重复导入", () => {
    const code = `
      import d from "domtify"
      import "domtify/methods/text"
      const el = d(".foo")
      el.text()
    `

    const output = runTransform(code)
    const matchs = output.match(
      new RegExp(escapeStringRegexp(`import "domtify/methods/text"`), "g"),
    )
    expect(matchs!.length).toBe(1)
  })

  it("应能检测 require('domtify') 作为根导入", () => {
    const code = `
      const d = require("domtify")
      const el = d(".foo")
      el.addClass()
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/addClass"')
  })

  it("应能正确处理 链式调用 的实例方法", () => {
    const code = `
      import d from "domtify"
      const el = d(".foo").parent().addClass('bar')
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/parent"')
    expect(output).toContain('import "domtify/methods/addClass"')
  })

  it("应能正确处理 计算属性访问（例如 instance[methodName]()）", () => {
    const code = `
      import d from "domtify"
      const el = d(".foo")
      el["parent"]()
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/parent"')
  })

  it("新情况", () => {
    const code = `
import d from "domtify";

let tempVar;

const fn = (selector) => {
  tempVar = d(selector).parent();

  tempVar.hasClass("aaa");

  console.log(tempVar);
};


export default fn;


    `
    const output = runTransform(code)

    expect(output).toContain('import "domtify/methods/parent"')
    expect(output).toContain('import "domtify/methods/hasClass"')
  })

  it("Class:1", () => {
    const code = `
import d from "domtify";

class Foo {
  // 成员变量
  #tmpVar;

  #has;
  constructor(selector) {
    this.#tmpVar = d(selector).parent();
  }
}
export default Foo;
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/parent"')
  })

  it("Class:2", () => {
    const code = `
import d from "domtify"

class Foo {
  // 私有成员变量
  #tmpVar = d("www").parent()
  // 普通成员变量
  memberVar = d("www").parents()  
  #has
  constructor(selector) {
    this.#has = this.#tmpVar.hasClass("bar")
    this.#tmpVar.siblings("bar")
    this.memberVar.find('.a').empty().css()
  }
}
export default Foo

    `
    const output = runTransform(code)

    expect(output).toContain('import "domtify/methods/parent"')
    expect(output).toContain('import "domtify/methods/parents"')
    expect(output).toContain('import "domtify/methods/hasClass"')
    expect(output).toContain('import "domtify/methods/siblings"')
    expect(output).toContain('import "domtify/methods/css"')
    expect(output).toContain('import "domtify/methods/empty"')
    expect(output).toContain('import "domtify/methods/find"')
  })

  it("class:3", () => {
    const code = `
import d from "domtify";
class Foo {
  // 私有成员变量
  #tmpVar = d("www").parent();
  // 普通成员变量
  memberVar = d("www").parents();
  #has;
  constructor(selector) {
    this.#has = this.#tmpVar;
    this.#has.find(".a").empty().css();
  }
}
export default Foo;


    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/parent"')
    expect(output).toContain('import "domtify/methods/parents"')
    expect(output).toContain('import "domtify/methods/css"')
    expect(output).toContain('import "domtify/methods/empty"')
    expect(output).toContain('import "domtify/methods/find"')
  })

  it("Class:4", () => {
    const code = `
import d from "domtify";



class Foo {
  // 私有成员变量
  #tmpVar = d;
  tmpVar = d;

  constructor(selector) {
    this.#tmpVar(".a").css();
    this.tmpVar(".a").addClass("q");
    const res = this.tmpVar.isFunction(() => {});
    console.log(res);
  }
}
export default Foo;
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/css"')
    expect(output).toContain('import "domtify/methods/addClass"')
    expect(output).toContain('import "domtify/utilities/isFunction"')
  })

  it("普通对象的属性赋值", () => {
    const code = `
import d from "domtify";

// 情况1：普通对象的属性赋值
const obj = {};
obj.prop = d("selector"); // 这里 obj.prop 被赋值为 domtify 实例

obj.prop.addClass("foo");


export default {};
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/addClass"')
  })

  it("嵌套对象属性赋值", () => {
    const code = `
import d from "domtify";

const container = {};
container.elements = {};
container.elements.button = d("#btn");  // 嵌套属性赋值
container.elements.button.addClass("test")


export default {};
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/addClass"')
  })

  it("数组1", () => {
    const code = `
import d from "domtify";

const arr = [];
arr[0] = d(".a").addClass('foo');  // 数组元素赋值

    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/addClass"')
  })

  it("数组2", () => {
    const code = `
import d from "domtify";

export default () => {
  const arr = [d(".a")];

  const a = arr[0].addClass("q");
  const b = a.parent();
};
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/addClass"')
    expect(output).toContain('import "domtify/methods/parent"')
  })

  it("Map", () => {
    const code = `
import d from "domtify";

export default () => {
  const map = new Map();
  map.set("obj", d(".a"));

  map.get("obj").addClass("abc");

  // console.log(map.get("obj"));
};
    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/addClass"')
  })

  it("case:2", () => {
    const code = `
import d from "domtify";

export default () => {
  const arr = [d(".a")];

  
  let method = "addClass";

  let res = arr[0][method](".a");
  const el = d(".a").parent.parents();
};

    `
    const output = runTransform(code)
    expect(output).toContain('import "domtify/methods/addClass"')
    expect(output).toContain('import "domtify/methods/parent"')
    expect(output).toContain('import "domtify/methods/parents"')
  })
})
