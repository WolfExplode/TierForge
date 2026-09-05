(function(root){
  'use strict';
  const encoder=new TextEncoder(), decoder=new TextDecoder();
  const signature=new Uint8Array([137,80,78,71,13,10,26,10]);
  const crcTable=Array.from({length:256},(_,n)=>{
    let value=n;
    for(let bit=0;bit<8;bit++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;
    return value>>>0;
  });
  const crc32=bytes=>{
    let crc=0xffffffff;
    for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);
    return (crc^0xffffffff)>>>0;
  };
  const uint32=(bytes,offset)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(offset);
  const pngBytes=input=>input instanceof Uint8Array?input:new Uint8Array(input);
  function assertPng(bytes){
    if(bytes.length<20||!signature.every((byte,index)=>bytes[index]===byte))throw new Error('Not a PNG file');
  }
  function chunk(type,data){
    const typeBytes=encoder.encode(type), result=new Uint8Array(12+data.length), view=new DataView(result.buffer);
    view.setUint32(0,data.length); result.set(typeBytes,4); result.set(data,8);
    view.setUint32(8+data.length,crc32(result.subarray(4,8+data.length)));
    return result;
  }
  function metadataChunk(value){
    const keyword=encoder.encode('tierforge'), text=encoder.encode(JSON.stringify(value));
    const data=new Uint8Array(keyword.length+5+text.length);
    data.set(keyword); // keyword NUL, compression flag, method, language NUL, translated keyword NUL
    data.set(text,keyword.length+5);
    return chunk('iTXt',data);
  }
  function concat(parts){
    const output=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));
    let offset=0; for(const part of parts){output.set(part,offset);offset+=part.length;} return output;
  }
  function embed(input,value){
    const bytes=pngBytes(input); assertPng(bytes);
    let offset=8, iend=-1;
    while(offset+12<=bytes.length){
      const length=uint32(bytes,offset),type=decoder.decode(bytes.subarray(offset+4,offset+8));
      if(type==='IEND'){iend=offset;break;} offset+=12+length;
    }
    if(iend<0)throw new Error('PNG has no IEND chunk');
    return concat([bytes.subarray(0,iend),metadataChunk(value),bytes.subarray(iend)]);
  }
  function readNull(data,start){
    const end=data.indexOf(0,start);
    if(end<0)throw new Error('Invalid PNG text metadata');
    return {text:decoder.decode(data.subarray(start,end)),next:end+1};
  }
  async function extract(input){
    const bytes=pngBytes(input); assertPng(bytes);
    let offset=8;
    while(offset+12<=bytes.length){
      const length=uint32(bytes,offset),end=offset+12+length;
      if(end>bytes.length)throw new Error('Truncated PNG chunk');
      const type=decoder.decode(bytes.subarray(offset+4,offset+8)),data=bytes.subarray(offset+8,offset+8+length);
      if(type==='iTXt'){
        const keyword=readNull(data,0);
        if(keyword.text==='tierforge'){
          const compressed=data[keyword.next], method=data[keyword.next+1]; let cursor=keyword.next+2;
          cursor=readNull(data,cursor).next; cursor=readNull(data,cursor).next;
          let text=data.subarray(cursor);
          if(compressed){
            if(method!==0||!globalThis.DecompressionStream)throw new Error('Unsupported compressed PNG metadata');
            text=new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
          }
          return JSON.parse(decoder.decode(text));
        }
      }else if(type==='tEXt'){
        const keyword=readNull(data,0);
        if(keyword.text==='tierforge')return JSON.parse(decoder.decode(data.subarray(keyword.next)));
      }
      if(type==='IEND')break;
      offset=end;
    }
    return null;
  }
  root.TierForgePng={embed,extract};
})(globalThis);
