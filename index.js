'use strict';

var fs = require('fs');
var int24 = require('int24');

Buffer.prototype.writeUInt24BE = function (value, offset) {
	int24.writeUInt24BE(this, offset, value);
	return offset + 3;
};

class BinaryArray {
	constructor(type, rows, cols) {
		this.type = type;
		this.rows = rows;
		this.cols = cols;

		var itemLength = 0;
		switch (type) {
			case 'UInt8':
				itemLength = 1;
				break;
			case 'UInt32':
				itemLength = 4;
				break;
			default:
				throw new Error('Unsupported type for BinaryArray: ' + type);
		}
		this.itemLength = itemLength;

		this.buffer = new Buffer(itemLength * rows);
	}

	write(data) {
		var method = 'write'+this.type+'BE';
		var offset = 0;
		for (var i = 0; i < this.rows.length; i++) {
			this.buffer[method](data[i] || 0, offset);
			offset += this.itemLength;
		}
		return offset;
	}

	pipe(stream) {
		stream.write(this.buffer);
	}
}

var BOX_HEADER_SIZE = 8;
var FULL_BOX_HEADER_SIZE = BOX_HEADER_SIZE + 4;

class Box {
	constructor(opts) {
		if (typeof opts == 'string') {
			opts = { type: opts };
		}

		this.buffer = new Buffer(0);

		this.writeNumber('UInt32', 0);
		this.write(opts.type, 4);

		if (typeof opts.version != 'undefined' && typeof opts.flags != 'undefined') {
			this.writeNumber('UInt8', opts.version);
			this.writeNumber('UInt24', opts.flags);
		}
	}

	writeNumber(type, data) {
		switch (type) {
			case 'Float8':
				type = 'Int16';
				data = Math.round(data * 256);
				break;
			case 'Float16':
				type = 'Int32';
				data = Math.round(data * 65536);
				break;
		}

		var length = 0;
		if (type.substr(-2) == '32') length = 4;
		else if (type.substr(-2) == '24') length = 3;
		else if (type.substr(-2) == '16') length = 2;
		else if (type.substr(-1) == '8') length = 1;
		else throw new Error('Unknown type length: '+type);

		var writer = 'write'+type+'BE';
		if (!this.buffer[writer]) {
			// Try without BE (e.g. for UInt8)
			writer = 'write'+type;
		}
		if (!this.buffer[writer]) {
			throw new Error('No Buffer writer for type '+type);
		}

		var buffer = new Buffer(length);
		buffer[writer](data);
		this.buffer = Buffer.concat([this.buffer, buffer]);
	}

	write(data, length) {
		if (typeof data == 'string') {
			data = new Buffer(data, 'binary');
		}
		this.buffer = Buffer.concat([this.buffer, data]);
	}

	pipe(stream) {
		this.buffer.writeUInt32BE(this.buffer.length);
		stream.write(this.buffer);
	}
}

function ftyp() {
	var box = new Box('ftyp');
	box.write('isom', 4);
	box.writeNumber('UInt32', 0);
	return box;
}

function free() {
	var box = new Box('free');
	return box;
}

function moov() {
	var box = new Box('moov');
	mvhd({}).pipe(box);
	trak().pipe(box);
	return box;
}

function mvhd(opts) {
	var box = new Box({
		type: 'mvhd',
		version: 0,
		flags: 0
	});
	box.writeNumber('UInt32', opts.creationTime || 0);
	box.writeNumber('UInt32', opts.modificationTime || 0);
	box.writeNumber('UInt32', opts.timeScale || 600);
	box.writeNumber('UInt32', opts.duration || 0x11111111);
	box.writeNumber('Float16', opts.rate || 256);
	box.writeNumber('Float8', opts.volume || 1);
	box.write(new Buffer(10));
	(new BinaryArray('UInt32', 9)).pipe(box);
	box.write(new Buffer(6 * 4));
	box.writeNumber('UInt32', opts.nextTrackId || 1);
	return box;
}

function trak() {
	var box = new Box('trak');
	tkhd({}).pipe(box);
	mdia().pipe(box);
	return box;
}

function tkhd(opts) {
	var box = new Box({
		type: 'tkhd',
		version: 0,
		flags: 15
	});
	box.writeNumber('UInt32', opts.creationTime || 0);
	box.writeNumber('UInt32', opts.modificationTime || 0);
	box.writeNumber('UInt32', opts.trackId || 1);
	box.write(new Buffer(4));
	box.writeNumber('UInt32', opts.duration || 0x11111111);
	box.write(new Buffer(8));
	box.writeNumber('UInt16', opts.layer || 0);
	box.writeNumber('UInt16', opts.alternateGroup || 0);
	box.writeNumber('Float8', opts.volume || 0);
	box.write(new Buffer(2));
	(new BinaryArray('UInt32', 9)).pipe(box);
	box.writeNumber('Float16', opts.width || 1920);
	box.writeNumber('Float16', opts.height || 1080);
	return box;
}

function mdia() {
	var box = new Box('mdia');
	mdhd({}).pipe(box);
	hdlr().pipe(box);
	minf().pipe(box);
	return box;
}

function mdhd(opts) {
	var box = new Box({
		type: 'mdhd',
		version: 0,
		flags: 0
	});
	box.writeNumber('UInt32', opts.creationTime || 0);
	box.writeNumber('UInt32', opts.modificationTime || 0);
	box.writeNumber('UInt32', opts.timeScale || 1);
	box.writeNumber('UInt32', opts.duration || 0x11111111);
	box.writeNumber('UInt16', opts.language || 0); // TODO: language, ISO639
	box.write(new Buffer(2));
	return box;
}

function hdlr() {
	var box = new Box({
		type: 'hdlr',
		version: 0,
		flags: 0
	});
	box.write('mhlr');
	box.write('vide');
	box.write(new Buffer(4 * 3));
	// optional: write(component name)
	return box;
}

function minf() {
	var box = new Box('minf');
	stbl().pipe(box);
	return box;
}

function stbl() {
	var box = new Box('stbl');
	stsd().pipe(box);
	return box;
}

function stsd() {
	var box = new Box({
		type: 'stsd',
		version: 0,
		flags: 0
	});
	box.writeNumber('UInt32', 1);
	avc1().pipe(box);
	return box;
}

function avc1() {
	var box = new Box('avc1');
	box.write(new Buffer(6)); // Reserved
	box.writeNumber('UInt16', 1); // dataReferenceIndex
	box.writeNumber('UInt16', 0); // Version
	box.writeNumber('UInt16', 0); // Revision level
	box.writeNumber('UInt32', 0); // Vendor
	box.writeNumber('UInt32', 0); // Temporal quality
	box.writeNumber('UInt32', 0); // Spatial quality
	box.writeNumber('UInt16', 1920); // Width
	box.writeNumber('UInt16', 1080); // Height
	box.writeNumber('Float16', 72); // horizontalResolution
	box.writeNumber('Float16', 72); // verticalResolution
	box.writeNumber('UInt32', 0); // Reserved
	box.writeNumber('UInt16', 1); // frameCount

	var compressorName = '';
	box.writeNumber('UInt8', compressorName.length); // compressorName
	box.write(compressorName);
	box.write(new Buffer(32 - compressorName.length - 1));
	box.writeNumber('UInt16', 24); // depth
	box.writeNumber('UInt16', 0xffff); // Color table ID

	avcC({}).pipe(box);

	return box;
}

function avcC(opts) {
	var box = new Box('avcC');
	box.writeNumber('UInt8', opts.configurationVersion || 1);
	box.writeNumber('UInt8', opts.avcProfileIndication || 66);
	box.writeNumber('UInt8', opts.profileCompatibility || 192);
	box.writeNumber('UInt8', opts.avcLevelIndication || 40);
	box.writeNumber('UInt8', opts.lengthSizeMinusOne || 3);

	// sps
	var sps = new BinaryArray('UInt8', 22);
	sps.write([103, 66, 192, 40, 218, 1, 224, 8, 159, 150, 16, 0, 0, 62, 144, 0, 14, 166, 0, 241, 131, 42]);
	box.writeNumber('UInt8', 1);
	box.writeNumber('UInt16', 22);
	sps.pipe(box);

	// pps
	var pps = new BinaryArray('UInt8', 4);
	pps.write([104, 206, 15, 200]);
	box.writeNumber('UInt8', 1);
	box.writeNumber('UInt16', 4);
	pps.pipe(box);

	return box;
}

function mdat(h264) {
	var box = new Box('mdat');
	box.write(h264);
	return box;
}

function output(filepath) {
	var h264 = fs.readFileSync('input.h264', 'binary');

	var stream = fs.createWriteStream(filepath);
	ftyp().pipe(stream);
	//free().pipe(stream);
	moov().pipe(stream);
	mdat(h264).pipe(stream);
	stream.end();
}

output('output.mp4');
