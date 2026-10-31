using AnimeStudio;
using System.Text.Json;
using System.Security.Cryptography;
if (args.Length != 3) throw new ArgumentException("Usage: AssetMap STUDIO MAP OUTPUT_JSON");
var studio = Path.GetFullPath(args[0]); var input = Path.GetFullPath(args[1]);
System.Runtime.Loader.AssemblyLoadContext.Default.Resolving += (context, name) => {
    var path = Path.Combine(studio, "bin", name.Name + ".dll");
    return File.Exists(path) ? context.LoadFromAssemblyPath(path) : null;
};
using var stream = File.OpenRead(input);
var digest = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant(); stream.Position = 0;
var map = MessagePack.MessagePackSerializer.Deserialize<AssetMap>(stream,
    MessagePack.MessagePackSerializerOptions.Standard.WithCompression(MessagePack.MessagePackCompression.Lz4BlockArray));
var entries = map.AssetEntries.Where(e => e.Type is ClassIDType.Sprite or ClassIDType.Texture2D)
    .Select(e => new { e.Name, e.Container, e.Source, e.Offset, PathID = e.PathID.ToString(), Type = e.Type.ToString() }).ToArray();
using var output = new FileStream(args[2], FileMode.CreateNew);
JsonSerializer.Serialize(output, new { map = input, sha256 = digest, entries });
Console.WriteLine($"Exported {entries.Length} image entries (no container truncation filter)");
