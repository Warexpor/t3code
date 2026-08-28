import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  manager: null as unknown as ReturnType<
    typeof import("./thread-outbox-manager").createThreadOutboxManager
  >,
  removePersistedFile: vi.fn(async () => undefined),
  setPendingConnectionError: vi.fn(),
  draftFile: (() => {
    let document = "";
    let writeError: Error | null = null;
    return {
      setDocument(value: unknown) {
        document = JSON.stringify(value);
      },
      setWriteError(error: Error | null) {
        writeError = error;
      },
      Directory: class {
        create() {}
      },
      File: class {
        exists = true;
        parentDirectory = null;

        create() {}

        moveSync() {}

        async text() {
          return document;
        }

        write(value: string) {
          if (writeError) {
            throw writeError;
          }
          document = value;
        }
      },
    };
  })(),
}));

vi.mock("expo-file-system", () => ({
  Directory: harness.draftFile.Directory,
  File: harness.draftFile.File,
  Paths: { document: "/documents" },
}));

vi.mock("../lib/composerImages", () => ({
  removePersistedComposerAttachmentFile: harness.removePersistedFile,
  toUploadChatImageAttachments: () => [],
}));

vi.mock("../lib/uuid", () => ({
  uuidv4: () => "00000000-0000-4000-8000-000000000000",
  randomHex: () => "abcd",
}));

vi.mock("../lib/attachmentUpload", () => ({
  prepareTurnAttachments: vi.fn(),
}));

vi.mock("./entities", () => ({
  useProjects: () => [],
  useServerConfigs: () => new Map(),
  useThreadShells: () => [],
}));

vi.mock("./threads", () => ({
  threadEnvironment: {},
}));

vi.mock("./use-atom-command", () => ({
  useAtomCommand: () => async () => undefined,
}));

vi.mock("./use-thread-outbox", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return {
    editingQueuedMessageIdsAtom: Atom.make<Record<string, boolean>>({}).pipe(Atom.keepAlive),
    useThreadOutboxMessages: () => ({}),
    useThreadOutboxShellStatuses: () => new Map(),
  };
});

vi.mock("./use-remote-environment-registry", () => ({
  setPendingConnectionError: harness.setPendingConnectionError,
  useRemoteConnectionStatus: () => ({ connectedEnvironments: [] }),
}));

vi.mock("./thread-outbox", async () => {
  const { createThreadOutboxManager } = await import("./thread-outbox-manager");
  const { appAtomRegistry } = await import("./atom-registry");
  harness.manager = createThreadOutboxManager({
    registry: appAtomRegistry,
    storage: {
      load: async () => [],
      write: async () => undefined,
      remove: async () => undefined,
    },
  });
  const manager = harness.manager;
  return {
    threadOutboxManager: manager,
    flushThreadOutbox: async () => undefined,
    ensureThreadOutboxLoaded: () => undefined,
    confirmThreadOutboxMessageQueued: (message: never) => manager.confirmQueued(message),
    updateThreadOutboxMessage: (message: never, expectedRevision?: number) =>
      manager.update(message, expectedRevision),
    threadOutboxRevision: (messageId: never) => manager.revisionOf(messageId),
  };
});

import { appAtomRegistry } from "./atom-registry";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import * as composerDrafts from "./use-composer-drafts";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import {
  completeQueuedMessageDelivery,
  recoverEditedCreationAfterDelivery,
  restoreRejectedQueuedMessage,
} from "./use-thread-outbox-drain";

function queuedMessage(input: {
  readonly messageId: string;
  readonly text: string;
  readonly fileUri?: string;
}): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    messageId: MessageId.make(input.messageId),
    commandId: CommandId.make(`command-${input.messageId}`),
    text: input.text,
    attachments: input.fileUri
      ? [
          {
            id: `file-${input.messageId}`,
            type: "file",
            name: "report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 42,
            fileUri: input.fileUri,
          },
        ]
      : [],
    createdAt: "2026-08-24T12:00:00.000Z",
  };
}

function remainingMessages(): ReadonlyArray<QueuedThreadMessage> {
  return Object.values(appAtomRegistry.get(harness.manager.queuedMessagesByThreadKeyAtom)).flat();
}

beforeEach(() => {
  harness.draftFile.setDocument({ schemaVersion: 1, drafts: {} });
});

afterEach(() => {
  appAtomRegistry.set(harness.manager.queuedMessagesByThreadKeyAtom, {});
  appAtomRegistry.set(composerDrafts.composerDraftsAtom, {});
  appAtomRegistry.set(editingQueuedMessageIdsAtom, {});
  harness.draftFile.setWriteError(null);
  harness.removePersistedFile.mockClear();
  harness.setPendingConnectionError.mockClear();
});

describe("thread outbox drain delivery cleanup", () => {
  it("keeps an edited message and its files when delivery cleanup loses the revision race", async () => {
    const message = queuedMessage({
      messageId: "message-edited",
      text: "original",
      fileUri: "file:///documents/t3-composer-attachments/report.pdf",
    });
    await harness.manager.enqueue(message);
    const deliveryRevision = harness.manager.revisionOf(message.messageId);
    const edited = { ...message, text: "edited while the turn delivered" };
    await harness.manager.update(edited);

    await expect(completeQueuedMessageDelivery(message, deliveryRevision)).resolves.toBe("edited");

    expect(remainingMessages()).toEqual([edited]);
    expect(harness.removePersistedFile).not.toHaveBeenCalled();
  });

  it("removes the delivered message when no edit was accepted", async () => {
    const message = queuedMessage({ messageId: "message-clean", text: "hello" });
    await harness.manager.enqueue(message);
    const deliveryRevision = harness.manager.revisionOf(message.messageId);

    await expect(completeQueuedMessageDelivery(message, deliveryRevision)).resolves.toBe("removed");

    expect(remainingMessages()).toEqual([]);
  });
});

describe("thread outbox delivered creation recovery", () => {
  it("keeps an edit accepted while the older payload is persisted to the draft", async () => {
    const message = queuedMessage({
      messageId: "message-recovery-race",
      text: "original queued text",
      fileUri: "file:///documents/t3-composer-attachments/report.pdf",
    });
    const originalMergeComposerDraftContent = composerDrafts.mergeComposerDraftContent;
    const mergeCompleted = Promise.withResolvers<void>();
    const releaseRecovery = Promise.withResolvers<void>();
    const mergeSpy = vi
      .spyOn(composerDrafts, "mergeComposerDraftContent")
      .mockImplementation(async (draftKey, content) => {
        const result = await originalMergeComposerDraftContent(draftKey, content);
        mergeCompleted.resolve();
        await releaseRecovery.promise;
        return result;
      });

    try {
      await harness.manager.enqueue(message);
      const recovery = recoverEditedCreationAfterDelivery(message);
      await mergeCompleted.promise;

      const newer = { ...message, text: "edited while recovery persisted the draft" };
      await harness.manager.update(newer);

      releaseRecovery.resolve();
      await expect(recovery).resolves.toBe(false);

      expect(remainingMessages()).toEqual([newer]);
      expect(
        composerDrafts.getComposerDraftSnapshot(`${message.environmentId}:${message.threadId}`),
      ).toMatchObject({ text: message.text, attachments: [] });
      expect(harness.removePersistedFile).not.toHaveBeenCalled();
    } finally {
      releaseRecovery.resolve();
      mergeSpy.mockRestore();
    }
  });

  it("leaves recovery to an editor that opens while the draft persists", async () => {
    const message = queuedMessage({
      messageId: "message-recovery-editor",
      text: "recover this text",
      fileUri: "file:///documents/t3-composer-attachments/editor.pdf",
    });
    const originalMergeComposerDraftContent = composerDrafts.mergeComposerDraftContent;
    const mergeCompleted = Promise.withResolvers<void>();
    const releaseRecovery = Promise.withResolvers<void>();
    const mergeSpy = vi
      .spyOn(composerDrafts, "mergeComposerDraftContent")
      .mockImplementation(async (draftKey, content) => {
        const result = await originalMergeComposerDraftContent(draftKey, content);
        mergeCompleted.resolve();
        await releaseRecovery.promise;
        return result;
      });

    try {
      await harness.manager.enqueue(message);
      const recovery = recoverEditedCreationAfterDelivery(message);
      await mergeCompleted.promise;
      appAtomRegistry.set(editingQueuedMessageIdsAtom, { [message.messageId]: true });

      releaseRecovery.resolve();
      await expect(recovery).resolves.toBe(true);

      expect(remainingMessages()).toEqual([message]);
      expect(
        composerDrafts.getComposerDraftSnapshot(`${message.environmentId}:${message.threadId}`),
      ).toMatchObject({ text: message.text, attachments: [] });
      expect(harness.removePersistedFile).not.toHaveBeenCalled();
    } finally {
      releaseRecovery.resolve();
      mergeSpy.mockRestore();
    }
  });

  it("retries a failed removal without duplicating recovered draft content", async () => {
    const message = queuedMessage({
      messageId: "message-recovery-removal",
      text: "recover once",
      fileUri: "file:///documents/t3-composer-attachments/retry.pdf",
    });
    const draftKey = `${message.environmentId}:${message.threadId}`;
    const removeSpy = vi
      .spyOn(harness.manager, "remove")
      .mockRejectedValueOnce(new Error("storage unavailable"));

    try {
      await harness.manager.enqueue(message);

      await expect(recoverEditedCreationAfterDelivery(message)).resolves.toBe(false);
      expect(remainingMessages()).toEqual([message]);

      await expect(recoverEditedCreationAfterDelivery(message)).resolves.toBe(true);

      const draft = composerDrafts.getComposerDraftSnapshot(draftKey);
      expect(draft.text).toBe(message.text);
      expect(draft.attachments).toEqual(message.attachments);
      expect(remainingMessages()).toEqual([]);
      expect(harness.removePersistedFile).not.toHaveBeenCalled();
    } finally {
      removeSpy.mockRestore();
    }
  });

  it("keeps the queue entry when the recovered draft cannot persist", async () => {
    const message = queuedMessage({
      messageId: "message-recovery-persistence",
      text: "recover after persistence returns",
    });
    await harness.manager.enqueue(message);
    harness.draftFile.setWriteError(new Error("disk full"));

    await expect(recoverEditedCreationAfterDelivery(message)).resolves.toBe(false);

    expect(remainingMessages()).toEqual([message]);
  });
});

describe("thread outbox recovery rollback", () => {
  it("rolls a failed recovery merge back so the retry cannot duplicate the text", async () => {
    const message = queuedMessage({ messageId: "message-restore", text: "queued text" });
    const draftKey = `${message.environmentId}:${message.threadId}`;
    appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
      [draftKey]: { text: "typed offline", attachments: [] },
    });
    await harness.manager.enqueue(message);

    harness.draftFile.setWriteError(new Error("disk full"));
    await expect(restoreRejectedQueuedMessage(message, "too large")).resolves.toBe("retry");

    // The merge was rolled back and the message stayed queued for the retry.
    expect(composerDrafts.getComposerDraftSnapshot(draftKey).text).toBe("typed offline");
    expect(remainingMessages()).toEqual([message]);

    harness.draftFile.setWriteError(null);
    await expect(restoreRejectedQueuedMessage(message, "too large")).resolves.toBe("restored");

    // The recovered text landed exactly once and the message left the queue.
    expect(composerDrafts.getComposerDraftSnapshot(draftKey).text).toBe(
      "typed offline\n\nqueued text",
    );
    expect(remainingMessages()).toEqual([]);
    expect(harness.setPendingConnectionError).toHaveBeenCalledWith("too large");
  });
});
