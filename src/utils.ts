export default {
  indent(level: number, text: string) {
    return `${" ".repeat(level * 2)}${text}` // 每级缩进2空格
  },
}
