import os
import sys
from PIL import Image

def hex_to_rgb(hex_color):
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def replace_color(img, old_color, new_color):
    img = img.convert('RGBA')
    data = img.getdata()
    new_data = []
    for item in data:
        if item[:3] == old_color:
            new_data.append(new_color + (item[3],))
        else:
            new_data.append(item)
    img.putdata(new_data)
    return img

def main():
    if len(sys.argv) != 5:
        print("Usage: python replace_color_in_images.py <input_folder> <output_folder> <old_color_hex> <new_color_hex>")
        sys.exit(1)

    input_folder = sys.argv[1]
    output_folder = sys.argv[2]
    old_color = hex_to_rgb(sys.argv[3])
    new_color = hex_to_rgb(sys.argv[4])

    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    for filename in os.listdir(input_folder):
        if filename.lower().endswith('.png'):
            input_path = os.path.join(input_folder, filename)
            output_path = os.path.join(output_folder, filename)
            with Image.open(input_path) as img:
                new_img = replace_color(img, old_color, new_color)
                new_img.save(output_path)
                print(f"Processed {filename}")

if __name__ == "__main__":
    main() 