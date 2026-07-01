import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { useUiStore } from '@/stores/uiStore';

/**
 * Check GitHub Releases for a newer version.
 *
 * On success with an update available, populates `updateAvailable` in the UI
 * store so the toolbar / banner can prompt the user. When `silent` is true
 * (startup check) failures and "no update" are swallowed; otherwise failures
 * surface through the shared error banner and "no update" shows a brief dialog.
 */
export async function checkForUpdates(silent = false): Promise<void> {
  const ui = useUiStore.getState();
  if (ui.updateChecking || ui.updateDownloading) return;

  ui.setUpdateChecking(true);
  try {
    const update = await check();
    if (update) {
      useUiStore.getState().setUpdateAvailable({
        version: update.version,
        notes: update.body ?? undefined,
      });
    } else {
      useUiStore.getState().setUpdateAvailable(null);
      if (!silent) {
        // Purely informational — use message() (OK only) rather than ask(),
        // which would render a needless Cancel button.
        await message('当前已是最新版本。', { title: '检查更新', kind: 'info' });
      }
    }
  } catch (err) {
    if (!silent) {
      useUiStore.getState().setError(`检查更新失败: ${err}`);
    } else {
      console.error('Silent update check failed:', err);
    }
  } finally {
    useUiStore.getState().setUpdateChecking(false);
  }
}

/**
 * Download and install the pending update, then offer to relaunch.
 *
 * Re-runs `check()` to obtain a live Update handle (the store only holds
 * serializable metadata), downloads and installs the update while
 * `updateDownloading` keeps the UI in a busy state, and prompts the user to
 * restart on completion. Download progress is not surfaced yet — `updateDownloading`
 * is a plain busy flag, so the banner shows an indeterminate "更新中…" until done.
 */
export async function runUpdate(): Promise<void> {
  const ui = useUiStore.getState();
  if (ui.updateDownloading) return;

  ui.setUpdateDownloading(true);
  try {
    const update = await check();
    if (!update) {
      useUiStore.getState().setUpdateAvailable(null);
      return;
    }

    await update.downloadAndInstall();

    useUiStore.getState().setUpdateAvailable(null);
    const relaunchNow = await ask(
      `Shark ${update.version} 已安装。是否立即重启以应用更新？`,
      { title: '更新完成', kind: 'info' },
    );
    if (relaunchNow) {
      await relaunch();
    }
  } catch (err) {
    useUiStore.getState().setError(`更新失败: ${err}`);
  } finally {
    useUiStore.getState().setUpdateDownloading(false);
  }
}
