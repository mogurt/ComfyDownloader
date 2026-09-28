import { describe, expect, it } from "vitest";
import { cleanFilenameForSearch, getModelBaseDir, joinPath } from "./utils";

describe("joinPath", () => {
  it("keeps the separator style of the base path", () => {
    expect(joinPath("C:\\ComfyUI\\models", "loras", "sdxl")).toBe("C:\\ComfyUI\\models\\loras\\sdxl");
    expect(joinPath("/Users/me/ComfyUI/models", "loras")).toBe("/Users/me/ComfyUI/models/loras");
  });

  it("does not double separators and skips empty parts", () => {
    expect(joinPath("C:\\models\\", "\\loras\\", "")).toBe("C:\\models\\loras");
    expect(joinPath("/models/", "/vae/")).toBe("/models/vae");
  });
});

describe("getModelBaseDir", () => {
  it("prefers the explicit model dir", () => {
    expect(getModelBaseDir({ model_base_dir: "D:\\models", comfyui_root: "C:\\ComfyUI" })).toBe("D:\\models");
  });

  it("falls back to <comfyui_root>/models", () => {
    expect(getModelBaseDir({ model_base_dir: "", comfyui_root: "C:\\ComfyUI" })).toBe("C:\\ComfyUI\\models");
    expect(getModelBaseDir({ model_base_dir: "", comfyui_root: "/opt/ComfyUI" })).toBe("/opt/ComfyUI/models");
    expect(getModelBaseDir({ model_base_dir: "", comfyui_root: "" })).toBe("");
  });
});

describe("cleanFilenameForSearch", () => {
  it("drops the extension and version suffix and splits words", () => {
    expect(cleanFilenameForSearch("sdxl_vae_v1.2.safetensors")).toBe("sdxl vae");
    expect(cleanFilenameForSearch("flux1-dev-v2.safetensors")).toBe("flux1 dev");
    expect(cleanFilenameForSearch("my__model.ckpt")).toBe("my model");
  });

  it("keeps names without a version suffix intact", () => {
    expect(cleanFilenameForSearch("realisticVision.safetensors")).toBe("realisticVision");
  });
});
