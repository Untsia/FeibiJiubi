; ============================================================================
; 菲比啾比 安装前/初始化时强制结束旧版主程序进程，
; 避免 NSIS 弹「菲比啾比 无法关闭 请手动关闭它 然后单击重试以继续」死循环。
;
; 弹窗真正来源：electron-builder 内置宏 CHECK_APP_RUNNING（installSection.nsh
; 第 33/36 行）检测到目标文件被占用时弹 MB_RETRYCANCEL 重试框。
;
; 占用者通常是正在运行的主程序 feibijiubi.exe（更新场景退出有延迟）。
; 注意：本脚本【绝不】taskkill explorer.exe —— 杀资源管理器会让用户桌面/任务栏
;       全部消失（黑屏），且本机实测也并未解决占用问题。
;
; 修复策略：
;   1) preInit（.onInit 最早）：先杀一遍主程序，覆盖手动重装场景。
;   2) customInit（.onInit 末尾，CHECK_APP_RUNNING 之前）：再连杀三遍 + 每次等
;      800ms，确保检测时主程序进程已彻底退出。
;
; 注意：运行时 exe 取自 name="feibijiubi" → 进程名 feibijiubi.exe（小写）。
;       productName="菲比啾比" 只影响窗口标题，不是进程名。
; nsExec 静默执行，找不到进程返回 128 也不阻断安装。
; ============================================================================

!macro preInit
  ; 主程序进程（小写 name 派生）。更新场景：旧 app 尚未完全退出时先杀一遍。
  nsExec::ExecToLog 'taskkill.exe /IM "feibijiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "FeibiJiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "菲比啾比.exe" /T /F'
!macroend

!macro customInit
  ; 更新场景：旧 app 可能刚被 quitAndInstall 触发退出，尚未完全释放句柄。
  ; 连杀三遍并等待，确保后续 CHECK_APP_RUNNING 检测不到主程序占用。
  nsExec::ExecToLog 'taskkill.exe /IM "feibijiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "FeibiJiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "菲比啾比.exe" /T /F'
  Sleep 800
  nsExec::ExecToLog 'taskkill.exe /IM "feibijiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "FeibiJiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "菲比啾比.exe" /T /F'
  Sleep 800
  nsExec::ExecToLog 'taskkill.exe /IM "feibijiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "FeibiJiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "菲比啾比.exe" /T /F'
  Sleep 800
!macroend
