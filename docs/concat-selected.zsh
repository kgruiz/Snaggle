#!/bin/zsh

source ~/.zshrc

cd /Users/kadengruizenga/Developer/Projects/Snaggle

tree -I "node_modules" > tree.txt
concat -x -m -R
cd src
concat -x -m

cd ..

mkdir -p concat-out

mv _concat-Snaggle.xml concat-out/
mv src/_concat-src.xml concat-out/
mv tree.txt concat-out/
