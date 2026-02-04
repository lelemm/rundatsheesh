export type SnapshotKind = "template" | "vm";

export interface SnapshotMeta {
  id: string;
  kind: SnapshotKind;
  createdAt: string;
  cpu: number;
  memMb: number;
  imageId?: string;
  kernelPath?: string;
  baseRootfsPath?: string;
  sourceVmId?: string;
  hasDisk: boolean;
  hasOverlay?: boolean; // true if snapshot includes overlay disk (overlayfs mode)
}

