import type { StageAdapter } from "@codegeneai/quality";

interface GreetOptions {
  readonly name?: string;
}

export const greetAdapter: StageAdapter<GreetOptions> = {
  type: "greet",
  label: "Greet adapter",
  description:
    "Logs a greeting — a stand-in for your own project-specific check.",
  supportsModes: ["check", "report"],
  async run(context) {
    const name = context.options.name ?? "world";
    return { status: "passed", messages: [`hello, ${name}!`] };
  },
};

export default { adapters: [greetAdapter] };
