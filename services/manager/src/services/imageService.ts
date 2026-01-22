import { eq, and, ne } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError } from "../api/httpErrors.js";

type AnyDb = any;
type AnyTable = any;

export type GuestImageRow = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  kernelFilename?: string | null;
  rootfsFilename?: string | null;
  baseRootfsBytes?: number | null;
  kernelUploadedAt?: string | null;
  rootfsUploadedAt?: string | null;
};

export type GuestImageListItem = GuestImageRow & {
  isDefault: boolean;
  hasKernel: boolean;
  hasRootfs: boolean;
};

export type ResolvedGuestImage = {
  imageId?: string;
  kernelSrcPath: string;
  baseRootfsPath: string;
  baseRootfsBytes: number;
};

const DEFAULT_KERNEL_FILENAME = "vmlinux";
const DEFAULT_ROOTFS_FILENAME = "rootfs.ext4";
const SETTINGS_DEFAULT_IMAGE_KEY = "defaultGuestImageId";

export class ImageService {
  constructor(
    private readonly db: AnyDb,
    private readonly guestImages: AnyTable,
    private readonly settings: AnyTable,
    private readonly vms: AnyTable,
    private readonly imagesDir: string,
    private readonly legacy?: { kernelPath?: string; baseRootfsPath?: string }
  ) {}

  async ensureImagesDir(): Promise<void> {
    await fs.mkdir(this.imagesDir, { recursive: true });
  }

  async list(): Promise<GuestImageListItem[]> {
    const [rows, defId] = await Promise.all([this.db.select().from(this.guestImages), this.getDefaultImageId()]);
    return (rows ?? []).map((r: any) => {
      const kernelFilename = r.kernelFilename ?? null;
      const rootfsFilename = r.rootfsFilename ?? null;
      return {
        id: String(r.id),
        name: String(r.name),
        description: String(r.description),
        createdAt: String(r.createdAt),
        kernelFilename,
        rootfsFilename,
        baseRootfsBytes: r.baseRootfsBytes ?? null,
        kernelUploadedAt: r.kernelUploadedAt ?? null,
        rootfsUploadedAt: r.rootfsUploadedAt ?? null,
        isDefault: defId === String(r.id),
        hasKernel: Boolean(kernelFilename),
        hasRootfs: Boolean(rootfsFilename)
      };
    });
  }

  async create(input: { name: string; description: string }): Promise<GuestImageRow> {
    const id = `img-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    await this.ensureImagesDir();
    await fs.mkdir(path.join(this.imagesDir, id), { recursive: true });
    const row = {
      id,
      name: input.name,
      description: input.description,
      createdAt,
      kernelFilename: null,
      rootfsFilename: null,
      baseRootfsBytes: null
    };
    await this.db.insert(this.guestImages).values(row);
    return row;
  }

  async setDefaultImageId(imageId: string): Promise<void> {
    const existing = await this.db.select().from(this.settings).where(eq(this.settings.key, SETTINGS_DEFAULT_IMAGE_KEY)).limit(1);
    if (existing?.[0]) {
      await this.db.update(this.settings).set({ value: imageId }).where(eq(this.settings.key, SETTINGS_DEFAULT_IMAGE_KEY));
    } else {
      await this.db.insert(this.settings).values({ key: SETTINGS_DEFAULT_IMAGE_KEY, value: imageId });
    }
  }

  async getDefaultImageId(): Promise<string | null> {
    const rows = await this.db.select().from(this.settings).where(eq(this.settings.key, SETTINGS_DEFAULT_IMAGE_KEY)).limit(1);
    const row = rows?.[0];
    if (!row) return null;
    const v = String((row as any).value ?? "");
    return v ? v : null;
  }

  async getById(imageId: string): Promise<GuestImageRow | null> {
    const rows = await this.db.select().from(this.guestImages).where(eq(this.guestImages.id, imageId)).limit(1);
    const r = rows?.[0];
    if (!r) return null;
    return {
      id: String(r.id),
      name: String(r.name),
      description: String(r.description),
      createdAt: String(r.createdAt),
      kernelFilename: r.kernelFilename ?? null,
      rootfsFilename: r.rootfsFilename ?? null,
      baseRootfsBytes: r.baseRootfsBytes ?? null,
      kernelUploadedAt: r.kernelUploadedAt ?? null,
      rootfsUploadedAt: r.rootfsUploadedAt ?? null
    };
  }

  imageDirForId(imageId: string): string {
    return path.join(this.imagesDir, imageId);
  }

  kernelPathFor(imageId: string, kernelFilename?: string | null): string {
    return path.join(this.imagesDir, imageId, kernelFilename || DEFAULT_KERNEL_FILENAME);
  }

  rootfsPathFor(imageId: string, rootfsFilename?: string | null): string {
    return path.join(this.imagesDir, imageId, rootfsFilename || DEFAULT_ROOTFS_FILENAME);
  }

  async markKernelUploaded(imageId: string, filename = DEFAULT_KERNEL_FILENAME): Promise<void> {
    const now = new Date().toISOString();
    await this.db.update(this.guestImages).set({ kernelFilename: filename, kernelUploadedAt: now }).where(eq(this.guestImages.id, imageId));
  }

  async markRootfsUploaded(imageId: string, filename = DEFAULT_ROOTFS_FILENAME): Promise<void> {
    const full = this.rootfsPathFor(imageId, filename);
    const st = await fs.stat(full);
    const now = new Date().toISOString();
    await this.db
      .update(this.guestImages)
      .set({ rootfsFilename: filename, baseRootfsBytes: st.size, rootfsUploadedAt: now })
      .where(eq(this.guestImages.id, imageId));
  }

  async delete(imageId: string): Promise<void> {
    const inUse = await this.db
      .select()
      .from(this.vms)
      .where(and(eq(this.vms.imageId, imageId), ne(this.vms.state, "DELETED")))
      .limit(1);
    if (inUse?.[0]) {
      throw new HttpError(409, "Image is in use by an active VM");
    }
    await this.db.delete(this.guestImages).where(eq(this.guestImages.id, imageId));
    await fs.rm(this.imageDirForId(imageId), { recursive: true, force: true }).catch(() => undefined);
    const def = await this.getDefaultImageId();
    if (def === imageId) {
      await this.db.delete(this.settings).where(eq(this.settings.key, SETTINGS_DEFAULT_IMAGE_KEY)).catch(() => undefined);
    }
  }

  async resolveForVmCreate(imageId?: string): Promise<ResolvedGuestImage> {
    if (imageId) {
      const img = await this.getById(imageId);
      if (!img) throw new HttpError(404, "Image not found");
      if (!img.kernelFilename || !img.rootfsFilename) throw new HttpError(400, "Image is missing kernel or rootfs");
      const kernelSrcPath = this.kernelPathFor(img.id, img.kernelFilename);
      const baseRootfsPath = this.rootfsPathFor(img.id, img.rootfsFilename);
      const baseRootfsBytes = typeof img.baseRootfsBytes === "number" ? img.baseRootfsBytes : (await fs.stat(baseRootfsPath)).size;
      return { imageId: img.id, kernelSrcPath, baseRootfsPath, baseRootfsBytes };
    }

    const def = await this.getDefaultImageId();
    if (def) return this.resolveForVmCreate(def);

    if (this.legacy?.kernelPath && this.legacy.baseRootfsPath) {
      const st = await fs.stat(this.legacy.baseRootfsPath);
      return {
        imageId: undefined,
        kernelSrcPath: this.legacy.kernelPath,
        baseRootfsPath: this.legacy.baseRootfsPath,
        baseRootfsBytes: st.size
      };
    }

    throw new HttpError(400, "No default image configured; upload an image and set it as default");
  }
}

