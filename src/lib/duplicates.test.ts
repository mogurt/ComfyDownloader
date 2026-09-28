import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  checkFileExists: vi.fn(),
  uniqueFilename: vi.fn(),
}));

import * as api from "@/lib/api";
import { resolveDuplicate } from "./duplicates";

const checkFileExists = vi.mocked(api.checkFileExists);
const uniqueFilename = vi.mocked(api.uniqueFilename);

describe("resolveDuplicate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("downloads under the requested name when it is free", async () => {
    checkFileExists.mockResolvedValue(false);
    await expect(resolveDuplicate("D:\\models", "a.safetensors", "skip")).resolves.toEqual({
      action: "download",
      filename: "a.safetensors",
    });
    expect(uniqueFilename).not.toHaveBeenCalled();
  });

  it("skips an existing file with the skip strategy", async () => {
    checkFileExists.mockResolvedValue(true);
    await expect(resolveDuplicate("D:\\models", "a.safetensors", "skip")).resolves.toEqual({ action: "skip" });
  });

  it("treats the retired overwrite strategy as skip", async () => {
    checkFileExists.mockResolvedValue(true);
    await expect(resolveDuplicate("D:\\models", "a.safetensors", "overwrite")).resolves.toEqual({ action: "skip" });
  });

  it("picks a free name with the rename strategy", async () => {
    checkFileExists.mockResolvedValue(true);
    uniqueFilename.mockResolvedValue("a (1).safetensors");
    await expect(resolveDuplicate("D:\\models", "a.safetensors", "rename")).resolves.toEqual({
      action: "download",
      filename: "a (1).safetensors",
      renamedFrom: "a.safetensors",
    });
    expect(uniqueFilename).toHaveBeenCalledWith("D:\\models", "a.safetensors");
  });

  it("propagates invalid-name errors from the backend", async () => {
    checkFileExists.mockRejectedValue("Invalid file name: ../x");
    await expect(resolveDuplicate("D:\\models", "../x", "rename")).rejects.toBe("Invalid file name: ../x");
  });
});
