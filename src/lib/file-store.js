import path from 'path';
import fs from 'fs-extra';

export class FileStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  listJsonFiles(filter = null) {
    if (!fs.existsSync(this.baseDir)) {
      return [];
    }
    return fs.readdirSync(this.baseDir)
      .filter(f => f.endsWith('.json'))
      .filter(f => !filter || filter(f))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.baseDir, f), 'utf8'));
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  }

  listDirectories(configFile = null) {
    if (!fs.existsSync(this.baseDir)) {
      return [];
    }
    return fs.readdirSync(this.baseDir)
      .filter(f => fs.statSync(path.join(this.baseDir, f)).isDirectory())
      .map(name => {
        let result = { name, id: name };
        if (configFile) {
          const configPath = path.join(this.baseDir, name, configFile);
          if (fs.existsSync(configPath)) {
            try {
              const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              result = { ...result, ...content };
            } catch (parseErr) {
              if (process.env.DEBUG) {
                console.warn(`Failed to parse ${configPath}: ${parseErr.message}`);
              }
            }
          }
        }
        return result;
      });
  }

  readJson(filename) {
    const filepath = path.join(this.baseDir, filename);
    if (!fs.existsSync(filepath)) {
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  writeJson(filename, data) {
    fs.ensureDirSync(this.baseDir);
    return fs.writeFileSync(path.join(this.baseDir, filename), JSON.stringify(data, null, 2));
  }
}
