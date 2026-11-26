# Takeout Tasks to ICS — 真实运行记录

时间：2026-11-26 12:18（Asia/Shanghai）
代码：`/workspace/tasks-to-ics/`
说明：这是交给 Gin 核的审查记录，不是已验证需求或销量。Outlook / Apple 提醒事项导入还没试。

## 打开了什么

- 内置示例：`sample/Tasks.json`（2 个列表 Personal / Work；含子任务、已完成和未完成、有到期日和无到期日、一条可映射的 `recurrence` RRULE、一条无法映射的 `recurrence` 字段、一条已删除任务）
- 测试夹具：含 `Takeout/Tasks/Tasks.json` 的 ZIP，以及不含该文件的 ZIP

## 得到了什么

- 单元测试：16 通过，0 失败。完整输出在 `proof/test-output.txt`。
- 用该示例实际生成的两份 ICS（无水印），并用 Python `icalendar` 库成功解析（不是坏文件）：
  - `proof/sample-vtodo.ics`：7 个 `VTODO`（已跳过 1 条删除任务）。含 `RELATED-TO` 子任务、`DUE;VALUE=DATE`、带时刻的 `DUE`、`STATUS:COMPLETED`、`RRULE:FREQ=WEEKLY;BYDAY=FR`。Work 列表里的 “Standup notes” 在预览和 ICS 中标明 `X-RECURRENCE-INCOMPLETE`（未能保留重复）。无到期日的 “Decide on a gift” 在 VTODO 中保留。
  - `proof/sample-vevent.ics`：6 个 `VEVENT`，只含有到期日的任务；“Decide on a gift” 未写入。
  - `proof/sample-per-list.zip`：按列表各一份 VTODO。
- 授权门槛（单元测试，未用真实购买码、也未自买）：空码、无效/退款/争议/订阅结束码不能解锁；网络失败不能解锁新码；`REVIEW-LOCAL-ONLY` 在配置或未配置 `product_id` 时都不能解锁，缓存里的审查码也会被忽略。未授权不能转用户自己的文件，示例仍可转。
- 错误提示：空文件、坏 JSON、ZIP 里没有 `Tasks.json` 都有明确错误。

## 还没做或还没试

- 公开审查页已部署：https://yetiancai12.github.io/takeout-tasks-to-ics/ 。Outlook / Apple 导入仍未实测。
- 没有用 Outlook 或 Apple 提醒事项实际导入，不能写成已经可以导入。
- 页面已写入官方 `product_id`，并去掉临时审查码和公开页上的审查提示，已加上 Gumroad 购买链接。商品当时仍未公开发售（公开 JSON 里 `is_published` 为 false）。官方校验还不能用真码测：未自买，也未公开发售。
