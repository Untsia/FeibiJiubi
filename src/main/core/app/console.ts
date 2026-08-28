// 控制台日志管理：输出到按日期轮转的日志文件，并按系统代码页转码避免中文乱码
// 原 src/core/app/console.js → TypeScript 迁移，行为逐行保持一致。
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');  // 引入 dayjs
const utc = require('dayjs/plugin/utc');  // 引入 UTC 插件
const timezone = require('dayjs/plugin/timezone');  // 引入 timezone 插件

// 使用插件
dayjs.extend(utc);
dayjs.extend(timezone);

// 获取日志文件路径
const logDirectory: string = path.join(process.env.FEIBIJIUBI_FOLDER_PATH, 'logs');
const logFileName = 'FeibiJiubi';
const maxLogSize = 5 * 1024 * 1024;
const logRetentionDays = 8; // 保留 8 天的日志
const currentDate: string = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD'); // 获取当前日期并格式化为 UTC+8 时间
const logFilePath: string = path.join(logDirectory, `${logFileName}-${currentDate}.log`); // 按日期命名日志文件

// 确保日志文件夹存在
if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
}

const iconv = require('iconv-lite');
let sysEnc = 'utf8';
if (process.platform === 'win32') {
  try {
    const cpOut: string = require('child_process').execSync(
      'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage" /v ACP',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const m = /ACP\s+REG_SZ\s+(\d+)/.exec(cpOut);
    const acp = m ? m[1] : '936';
    const map: Record<string, string> = { '936': 'gbk', '949': 'euc-kr', '950': 'big5', '932': 'shift_jis' };
    sysEnc = map[acp] || 'gbk';
  } catch (e) { sysEnc = 'gbk'; }
}
const isConsoleTTY: boolean = !!process.stdout.isTTY;
// 转码：TTY 直接返回字符串（走 WriteConsoleW Unicode）；非 TTY/写文件则返回对应代码页的 Buffer
function enc(str: string, target: string): string | Buffer {
  if (target === 'utf8') return str;
  try { return iconv.encode(str, target); } catch (e) { return str; }
}
const FILE_ENC = process.platform === 'win32' ? sysEnc : 'utf8';
const CONSOLE_ENC: string = (process.platform === 'win32' && !isConsoleTTY) ? sysEnc : 'utf8';

let logStream: any = fs.createWriteStream(logFilePath, { flags: 'a' });
// 检查日志文件大小并进行轮转
function checkLogFileSize(): void {
    fs.stat(logFilePath, (err: any, stats: any) => {
        if (err) return;
        // 如果日志文件大小超过了最大值，则进行轮转
        if (stats.size >= maxLogSize) {
            const archivedLogFilePath: string = path.join(logDirectory, `${logFileName}-${currentDate}-${Date.now()}.log`);
            fs.renameSync(logFilePath, archivedLogFilePath);
            logStream.close();
            logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
        }
    });
}

// 删除超过保留期限的日志文件
function deleteOldLogs(): void {
    fs.readdir(logDirectory, (err: any, files: string[]) => {
        if (err) return;

        const now = Date.now();
        files.forEach((file: string) => {
            const filePath: string = path.join(logDirectory, file);
            const stats = fs.statSync(filePath);
            // 如果文件是日志文件且超过保留期限，则删除
            if (file.startsWith(logFileName) && stats.isFile()) {
                const fileAgeDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24); // 计算文件的年龄（天）
                if (fileAgeDays > logRetentionDays) {
                    fs.unlinkSync(filePath); // 删除过期日志文件
                    console.log(`Deleted old log file: ${file}`);
                }
            }
        });
    });
}

deleteOldLogs(); // 删除旧的日志文件

// 获取当前时间并格式化为 UTC+8 时间
function getTimestamp(): string {
    return dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss');
}

// 重定向 console.log、console.error 输出到日志文件与终端
function emit(line: string): void {
    logStream.write(enc(line, FILE_ENC)); // 日志文件按系统代码页写出
    checkLogFileSize();
}
// 工厂：统一生成 console 方法，仅 [LEVEL] 标签与输出流不同
function makeConsoleMethod(level: string, stream: any): (...args: any[]) => void {
    return function (...args: any[]): void {
        const line = `[${getTimestamp()}] ${level}: ${args.join(' ')}\n`;
        emit(line);
        stream.write(enc(line, CONSOLE_ENC)); // 在控制台显示（按需转码）
    };
}
console.log = makeConsoleMethod('LOG', process.stdout);
console.error = makeConsoleMethod('ERROR', process.stderr);
console.warn = makeConsoleMethod('WARN', process.stderr);
console.info = makeConsoleMethod('INFO', process.stdout);