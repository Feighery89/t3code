import { AtomRegistry } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

vi.mock("./server", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return {
    environmentServerConfigsAtom: Atom.make(new Map()),
    serverEnvironment: { configValueAtom: Atom.family(() => Atom.make(null)) },
  };
});
vi.mock("../lib/attachmentUpload", () => ({ prepareTurnAttachments: vi.fn() }));
vi.mock("./use-remote-environment-registry", () => ({ setPendingConnectionError: vi.fn() }));
vi.mock("./use-composer-drafts", () => ({}));

vi.mock("../lib/uuid", () => ({
  randomHex: vi.fn(() => "00"),
  uuidv4: vi.fn(() => "00000000-0000-4000-8000-000000000000"),
}));

vi.mock("./presentation", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return { environmentPresentations: { presentationsAtom: Atom.make(new Map()) } };
});

vi.mock("./projects", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return { environmentProjects: { projectsAtom: Atom.make([]) } };
});

vi.mock("./threads", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return {
    environmentThreadShells: { threadShellsAtom: Atom.make([]) },
    threadEnvironment: {
      setInteractionMode: {},
      setRuntimeMode: {},
      startTurn: {},
      updateMetadata: {},
    },
  };
});

vi.mock("./use-thread-outbox", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return {
    dispatchingQueuedMessageIdAtom: Atom.make(null),
    editingQueuedMessageIdsAtom: Atom.make({}),
    threadOutboxShellStatusesAtom: Atom.make(new Map()),
  };
});

vi.mock("./thread-outbox", async () => {
  const { Atom } = await import("effect/unstable/reactivity");
  return {
    confirmThreadOutboxMessageQueued: vi.fn(),
    threadOutboxManager: {
      load: vi.fn(async () => true),
      queuedMessagesByThreadKeyAtom: Atom.make({}),
    },
    threadOutboxRevision: vi.fn(),
    updateThreadOutboxMessage: vi.fn(),
  };
});

import { threadOutboxManager } from "./thread-outbox";
import { acquireThreadOutboxDrain } from "./use-thread-outbox-drain";

describe("thread outbox drain ownership", () => {
  beforeEach(() => {
    vi.mocked(threadOutboxManager.load).mockClear();
  });

  it("shares one dispatcher until the final owner releases", async () => {
    const registry = AtomRegistry.make();
    const subscribe = vi.spyOn(registry, "subscribe");

    const releaseUi = acquireThreadOutboxDrain(registry);
    const subscriptionsPerDispatcher = subscribe.mock.calls.length;
    expect(subscriptionsPerDispatcher).toBeGreaterThan(0);
    expect(threadOutboxManager.load).toHaveBeenCalledTimes(1);

    const releaseBackground = acquireThreadOutboxDrain(registry);
    expect(subscribe).toHaveBeenCalledTimes(subscriptionsPerDispatcher);
    expect(threadOutboxManager.load).toHaveBeenCalledTimes(1);

    releaseUi();
    releaseUi();
    const releaseReplacementUi = acquireThreadOutboxDrain(registry);
    expect(subscribe).toHaveBeenCalledTimes(subscriptionsPerDispatcher);
    expect(threadOutboxManager.load).toHaveBeenCalledTimes(1);

    releaseBackground();
    expect(threadOutboxManager.load).toHaveBeenCalledTimes(1);
    releaseReplacementUi();

    const releaseNextOwner = acquireThreadOutboxDrain(registry);
    expect(subscribe).toHaveBeenCalledTimes(subscriptionsPerDispatcher * 2);
    expect(threadOutboxManager.load).toHaveBeenCalledTimes(2);
    releaseNextOwner();

    await Promise.resolve();
    registry.dispose();
  });
});
