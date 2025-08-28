# Git Integration Workflows - Common Scenarios

## Scenario 1: Existing GAS Project → New Git Repository

**Use Case**: You have an existing GAS project and want to add version control

### Steps:

1. **Initialize Git for the GAS project**
```bash
gas_init --scriptId="YOUR_SCRIPT_ID" --gasPath="." --gitUrl="https://github.com/user/repo.git"
```
This will:
- Create local mirror at `~/gas-repos/[scriptId]/`
- Initialize Git repository
- Set remote origin (optional)

2. **Commit current GAS state to Git**
```bash
gas_commit --scriptId="YOUR_SCRIPT_ID" --message="Initial commit from existing GAS project"
```
This will:
- Sync all files from GAS → Local mirror
- Create initial Git commit
- Preserve CommonJS module structure

3. **Push to remote repository** (if you have one)
```bash
gas_push --scriptId="YOUR_SCRIPT_ID" --branch="main"
```
This will:
- Use three-way merge if Git has existing content
- Push local commits to remote
- Establish main branch

**With Merge Strategies** (New):
```bash
# Force GAS content to Git (ignore any existing Git content)
gas_push --scriptId="YOUR_SCRIPT_ID" --mergeStrategy="gas-wins"

# Review changes before pushing
gas_push --scriptId="YOUR_SCRIPT_ID" --mergeStrategy="manual"
```

### Example Flow:
```bash
# 1. You have GAS project: 1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ

# 2. Create GitHub repo: https://github.com/myuser/my-gas-project

# 3. Initialize Git integration
gas_init \
  --scriptId="1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ" \
  --gitUrl="https://github.com/myuser/my-gas-project.git"

# 4. Commit existing code
gas_commit \
  --scriptId="1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ" \
  --message="Initial commit: Add existing GAS project code"

# 5. Push to GitHub
gas_push --scriptId="1arGk_0LU7E12afUFkp5ABrQdb0kLgOqwJR0OF__FbXN3G2gev7oix7XJ"
```

## Scenario 2: Existing Git Repository → GAS Project

**Use Case**: You have code in Git and want to deploy it to GAS

### Option A: Clone to Existing GAS Project

1. **Initialize Git for target GAS project**
```bash
gas_init --scriptId="TARGET_SCRIPT_ID" --gitUrl="https://github.com/user/repo.git"
```

2. **Pull code from Git to GAS**
```bash
gas_pull --scriptId="TARGET_SCRIPT_ID" --branch="main"
```
This will:
- Pull from Git remote → Local mirror
- Filter out Git metadata (.git/, .gitignore, etc.)
- Perform three-way merge with existing GAS content
- Sync merged code to GAS
- Convert dotfiles to virtual files (_gitignore.gs, etc.)

**With Merge Strategies** (New):
```bash
# Deploy Git code, overwriting GAS
gas_pull --scriptId="TARGET_SCRIPT_ID" --mergeStrategy="git-wins"

# Merge Git with GAS, preferring GAS for conflicts
gas_pull --scriptId="TARGET_SCRIPT_ID" --mergeStrategy="gas-wins"

# Manual review of all changes
gas_pull --scriptId="TARGET_SCRIPT_ID" --mergeStrategy="manual"
```

### Option B: Clone to New GAS Project

1. **Create new GAS project**
```bash
gas_project_create --title="My Project from Git" --localName="my-git-project"
```
Returns: `scriptId: 1abc2def3...`

2. **Clone Git repository to new project**
```bash
gas_git_clone \
  --scriptId="1abc2def3..." \
  --gitUrl="https://github.com/user/repo.git" \
  --branch="main"
```
This will:
- Clone entire repository
- Filter Git metadata
- Deploy code to GAS
- Set up Git integration

### Example Flow:
```bash
# Scenario A: You have Git repo with GAS-compatible code
# https://github.com/myteam/shared-utilities

# Option 1: Deploy to existing GAS project
gas_init \
  --scriptId="1d3SegHpHlTQ54U7ISofKGUI5JwOf8BOgkWO3xB0iQ-sy3xa8KC1qWn5v" \
  --gitUrl="https://github.com/myteam/shared-utilities.git"

gas_pull --scriptId="1d3SegHpHlTQ54U7ISofKGUI5JwOf8BOgkWO3xB0iQ-sy3xa8KC1qWn5v"

# Option 2: Create new GAS project for Git code
gas_project_create --title="Shared Utilities" --localName="shared-utils"
# Returns: scriptId: 1newProject123...

gas_git_clone \
  --scriptId="1newProject123..." \
  --gitUrl="https://github.com/myteam/shared-utilities.git"
```

## Important Considerations

### File Type Compatibility
GAS only supports:
- `.gs` files → SERVER_JS (JavaScript/Google Apps Script)
- `.html` files → HTML (for web apps/add-ons)
- `.json` files → JSON (mainly appsscript.json)

### What Gets Filtered
These never sync to GAS:
- `.git/` directory
- `.gitignore`, `.gitattributes` 
- `node_modules/`
- `.env` files
- `*.log`, `*.tmp` files

### CommonJS Module System
- GAS files automatically get CommonJS wrapper
- `require()`, `module.exports`, `exports` are available
- System files: `CommonJS.js` and `__mcp_gas_run.js`

### Virtual File Translation
Dotfiles in Git → Virtual files in GAS:
- `.gitignore` → `_gitignore.gs` (as CommonJS module)
- `.env.example` → `_env_example.gs`

## Quick Reference

| Starting Point | Goal | Commands | Merge Strategy |
|---------------|------|----------|----------------|
| Existing GAS project | Add to new Git repo | `gas_init` → `gas_commit` → `gas_push` | N/A (first sync) |
| Existing GAS project | Add to existing Git repo | `gas_init --gitUrl=...` → `gas_commit` → `gas_push` | `--mergeStrategy="auto"` |
| Git repository | Deploy to existing GAS | `gas_init --gitUrl=...` → `gas_pull` | `--mergeStrategy="git-wins"` |
| Git repository | Deploy to new GAS | `gas_project_create` → `gas_git_clone` | N/A (new project) |
| Local Git changes | Update GAS | `gas_pull` | `--mergeStrategy="auto"` |
| GAS changes | Update Git | `gas_commit` → `gas_push` | `--mergeStrategy="auto"` |
| Conflict resolution | Manual merge | `gas_pull` or `gas_push` | `--mergeStrategy="manual"` |

## Workflow Best Practices

1. **Always backup before major operations**
   - Export GAS project before pulling Git changes
   - Create Git branch before pushing GAS changes

2. **Test after sync operations**
   - Run `gas_run` to test functions after `gas_pull`
   - Verify no compilation errors in GAS editor

3. **Use meaningful commit messages**
   - `gas_commit --message="Add OAuth integration"`
   - `gas_push --commitMessage="Fix spreadsheet permissions bug"`

4. **Handle merge conflicts in Git**
   - Resolve conflicts in local Git repository
   - Then `gas_pull` to update GAS with resolved code

## Troubleshooting

### "Project not found" error
- Verify scriptId is correct
- Check you have access to the GAS project
- Ensure authentication: `gas_auth --mode=status`

### Files missing after sync
- Check if files match exclusion patterns
- Verify file extensions (.gs, .html, .json)
- Look for Git metadata filtering

### Sync conflicts
- Use three-way merge to resolve conflicts automatically
- Choose appropriate merge strategy:
  - `auto`: Intelligent merge (default)
  - `gas-wins`: GAS is source of truth
  - `git-wins`: Git overwrites GAS
  - `manual`: Review all changes
- Check backup directory if needed: `~/.gas-repos/[scriptId]/.gas-backup/`