const fs = require('fs');
const path = require('path');

const config = require('../config.json');

const sourceRoot = path.join(config.GenshinData_folder, 'BinOutput', 'InterAction');
const targets = [
	{
		root: path.join(config.genshin_export_folder, 'interactions'),
		manifest: path.join(config.genshin_export_folder, 'interactions.json')
	},
	{
		root: path.join(config.genshin_output_folder, 'interactions'),
		manifest: path.join(config.genshin_output_folder, 'interactions.json')
	}
];

function listJsonFiles(directory, relativeDirectory = '') {
	return fs.readdirSync(directory, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap(entry => {
			const relativePath = relativeDirectory
				? `${relativeDirectory}/${entry.name}`
				: entry.name;
			const absolutePath = path.join(directory, entry.name);

			if (entry.isDirectory()) return listJsonFiles(absolutePath, relativePath);
			if (entry.isFile() && entry.name.endsWith('.json')) return [relativePath];
			return [];
		});
}

function getManifestFiles(manifest) {
	try {
		const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
		return Array.isArray(data.files) ? data.files : [];
	} catch (e) {
		return [];
	}
}

function getTargetPath(rootPath, relativePath) {
	const root = path.resolve(rootPath);
	const target = path.resolve(root, ...relativePath.split('/'));
	if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
		throw new Error(`interactions: invalid relative path ${relativePath}`);
	}
	return target;
}

function removeStaleFiles(rootPath, previousFiles, currentFiles) {
	const current = new Set(currentFiles.map(file =>
		file.endsWith('.json') ? file.slice(0, -'.json'.length) : file));
	for (const previousFile of previousFiles) {
		const relativePath = previousFile.endsWith('.json') ? previousFile : `${previousFile}.json`;
		const sourcePath = relativePath.endsWith('.json')
			? relativePath.slice(0, -'.json'.length)
			: relativePath;
		if (current.has(sourcePath)) continue;

		const targetPath = getTargetPath(rootPath, relativePath);
		if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
			fs.unlinkSync(targetPath);
		}
	}
}

function copyFileIfChanged(sourcePath, targetPath) {
	const sourceStat = fs.statSync(sourcePath);
	let shouldCopy = true;

	if (fs.existsSync(targetPath)) {
		const targetStat = fs.statSync(targetPath);
		shouldCopy = sourceStat.size !== targetStat.size || sourceStat.mtimeMs > targetStat.mtimeMs + 1000;
	}

	if (!shouldCopy) return false;

	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	fs.copyFileSync(sourcePath, targetPath);
	fs.utimesSync(targetPath, sourceStat.atime, sourceStat.mtime);
	return true;
}

function writeManifest(manifestPath, files) {
	const manifest = {
		source: 'BinOutput/InterAction',
		files: files.map(file => file.slice(0, -'.json'.length))
	};

	fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));
}

function exportToTarget(files, target) {
	const previousFiles = getManifestFiles(target.manifest);
	removeStaleFiles(target.root, previousFiles, files);

	let copied = 0;
	for (const relativePath of files) {
		const sourcePath = path.join(sourceRoot, ...relativePath.split('/'));
		const targetPath = getTargetPath(target.root, relativePath);
		if (copyFileIfChanged(sourcePath, targetPath)) copied++;
	}

	writeManifest(target.manifest, files);
	return copied;
}

function exportInteraction() {
	const starttime = Date.now();
	if (!fs.existsSync(sourceRoot)) {
		console.log(`interactions source folder does not exist: ${sourceRoot}`);
		return;
	}

	const files = listJsonFiles(sourceRoot);
	const copied = targets.reduce((sum, target) => sum + exportToTarget(files, target), 0);
	console.log(`done interactions: ${files.length} files, ${copied} updated in ${(Date.now() - starttime) / 1000} seconds`);
}

module.exports = exportInteraction;
