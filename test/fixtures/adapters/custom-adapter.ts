import type { StageAdapter } from "../../../src/adapters/types";

type CustomOptions = {
  readonly message?: string;
};

export const customAdapter: StageAdapter<CustomOptions> = {
  type: "custom",
  label: "Custom fixture adapter",
  description: "Fixture adapter used in tests",
  async run(context) {
    const message = context.options.message ?? "none";
    return {
      status: "passed",
      messages: [`custom adapter: ${message}`],
    };
  },
};

export default { adapters: [customAdapter] };
