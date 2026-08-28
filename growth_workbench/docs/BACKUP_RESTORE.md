# 数据备份与恢复

## 日常备份

工作台右上角“备份数据”会复制 `data/` 到带时间戳的 `backups/workbench_*` 目录。该目录包含选题、脚本、审稿、灵感、账号、表现数据和资料收件箱文件。

命令行也可执行：

```bash
node scripts/backup.mjs
```

## 完整备份

需要同时备份 Content OS 数据库时：

```bash
node scripts/backup.mjs --full
```

完整备份会额外复制 `outputs/content_os_v1_phase2/postgres_data_release`，所需空间较大。备份过程中不要运行旧的数据库维护脚本。

## 恢复

先关闭工作台，再执行：

```bash
node scripts/restore.mjs "backups/workbench_时间戳"
```

恢复前脚本会把当前 `data/` 再保存一份到 `backups/pre_restore_*`，不会直接覆盖而不留退路。

恢复完整数据库快照必须人工确认路径；V0.1恢复脚本默认只恢复工作台数据，避免误伤锁定数据库。
